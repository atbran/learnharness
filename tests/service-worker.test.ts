import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";
import { wantsServiceWorker } from "../components/sw-register";

/** public/sw.js is a plain worker script; run it in a VM with a fake `self`,
 * `caches` and `fetch`, then drive its fetch handler like the browser would. */
const ORIGIN = "https://desktop-lnob1ib.tail446473.ts.net:8444";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

type Handler = (event: unknown) => void;
type Route = "static" | "navigate" | "passthrough";

function loadWorker(fetchImpl: (req: unknown, init?: { signal?: AbortSignal }) => Promise<Response>) {
	const handlers = new Map<string, Handler>();
	const stores = new Map<string, Map<string, Response>>();
	const keyOf = (r: unknown) => (typeof r === "string" ? new URL(r, ORIGIN).href : (r as { url: string }).url);
	const open = async (name: string) => {
		let store = stores.get(name);
		if (!store) stores.set(name, (store = new Map()));
		const s = store;
		return {
			match: async (r: unknown) => s.get(keyOf(r))?.clone(),
			put: async (r: unknown, res: Response) => void s.set(keyOf(r), res),
			keys: async () => [...s.keys()].map((url) => ({ url })),
			delete: async (r: unknown) => s.delete(keyOf(r)),
			addAll: async (reqs: unknown[]) => {
				for (const r of reqs) s.set(keyOf(r), new Response("<h1>Can't reach your PC.</h1>", { headers: { "Content-Type": "text/html" } }));
			},
		};
	};
	const caches = {
		open,
		keys: async () => [...stores.keys()],
		delete: async (name: string) => stores.delete(name),
		match: async (r: unknown, opts?: { cacheName?: string }) => stores.get(opts?.cacheName ?? "")?.get(keyOf(r))?.clone(),
	};
	const self = {
		location: { origin: ORIGIN },
		addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
		skipWaiting: async () => {},
		clients: { claim: async () => {} },
	};
	const context = vm.createContext({
		self, caches, fetch: fetchImpl, URL, Response,
		// A worker resolves relative Request URLs against its own location; Node's can't.
		Request: class {
			url: string;
			constructor(u: string) {
				this.url = new URL(u, ORIGIN).href;
			}
		}, AbortController, setTimeout, clearTimeout, console,
	});
	vm.runInContext(source, context);
	const route = context.lhRoute as (req: { method: string; url: string; mode: string; accept: string }, origin: string) => Route;

	async function lifecycle(type: "install" | "activate") {
		const pending: Promise<unknown>[] = [];
		handlers.get(type)!({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
		await Promise.all(pending);
	}
	/** Dispatch a fetch event; resolves to the worker's response, or undefined on passthrough. */
	async function dispatch(path: string, init: { method?: string; mode?: string; accept?: string } = {}) {
		let responded: Promise<Response> | undefined;
		const waits: Promise<unknown>[] = [];
		handlers.get("fetch")!({
			request: {
				url: new URL(path, ORIGIN).href,
				method: init.method ?? "GET",
				mode: init.mode ?? "cors",
				headers: new Headers(init.accept ? { accept: init.accept } : {}),
			},
			respondWith: (p: Promise<Response>) => (responded = p),
			waitUntil: (p: Promise<unknown>) => waits.push(p),
		});
		const res = await responded;
		await Promise.all(waits);
		return res;
	}
	return { route, lifecycle, dispatch, stores };
}

const r = (path: string, init: { method?: string; mode?: string; accept?: string } = {}) => ({
	method: init.method ?? "GET",
	url: path.startsWith("http") ? path : ORIGIN + path,
	mode: init.mode ?? "cors",
	accept: init.accept ?? "",
});

describe("service worker routing (public/sw.js lhRoute)", () => {
	const { route } = loadWorker(async () => new Response("net"));

	it("never intercepts the API, SSE included, even as a navigation", () => {
		assert.equal(route(r("/api/events", { accept: "text/event-stream" }), ORIGIN), "passthrough");
		assert.equal(route(r("/api/program/events", { accept: "text/event-stream" }), ORIGIN), "passthrough");
		assert.equal(route(r("/api/chats/123"), ORIGIN), "passthrough");
		assert.equal(route(r("/api/files/x.pdf", { mode: "navigate" }), ORIGIN), "passthrough");
		assert.equal(route(r("/api"), ORIGIN), "passthrough");
	});

	it("leaves any event stream, non-GET and cross-origin request alone", () => {
		assert.equal(route(r("/program", { accept: "text/event-stream" }), ORIGIN), "passthrough");
		assert.equal(route(r("/program", { method: "POST", mode: "navigate" }), ORIGIN), "passthrough");
		assert.equal(route(r("/_next/static/chunks/a.js", { method: "HEAD" }), ORIGIN), "passthrough");
		assert.equal(route(r("https://fonts.example.com/_next/static/a.css"), ORIGIN), "passthrough");
		assert.equal(route(r("not a url"), ORIGIN), "passthrough");
	});

	it("caches only hashed build assets; pages are network navigations; RSC fetches pass", () => {
		assert.equal(route(r("/_next/static/chunks/app-123.js"), ORIGIN), "static");
		assert.equal(route(r("/_next/static/css/abc.css"), ORIGIN), "static");
		assert.equal(route(r("/program", { mode: "navigate" }), ORIGIN), "navigate");
		assert.equal(route(r("/chat/abc?x=1", { mode: "navigate" }), ORIGIN), "navigate");
		assert.equal(route(r("/program?_rsc=1x2y"), ORIGIN), "passthrough");
		assert.equal(route(r("/_next/image?url=x"), ORIGIN), "passthrough");
		assert.equal(route(r("/manifest.webmanifest"), ORIGIN), "passthrough");
		assert.equal(route(r("/apiary", { mode: "navigate" }), ORIGIN), "navigate");
	});
});

describe("service worker fetch handling", () => {
	it("passthrough requests never get respondWith", async () => {
		let calls = 0;
		const w = loadWorker(async () => (calls++, new Response("net")));
		assert.equal(await w.dispatch("/api/events", { accept: "text/event-stream" }), undefined);
		assert.equal(await w.dispatch("/api/program/events"), undefined);
		assert.equal(await w.dispatch("/program", { method: "POST", mode: "navigate" }), undefined);
		assert.equal(calls, 0);
	});

	it("navigations go to the network and are never cached", async () => {
		const w = loadWorker(async () => new Response("<p>user data</p>", { status: 200 }));
		await w.lifecycle("install");
		const res = await w.dispatch("/program", { mode: "navigate" });
		assert.equal(await res!.text(), "<p>user data</p>");
		for (const store of w.stores.values()) assert.ok(![...store.keys()].some((k) => k.endsWith("/program")));
	});

	it("an unreachable PC (network error or Tailscale 502/504) shows offline.html", async () => {
		let mode: "throw" | 502 | 504 | 500 = "throw";
		const w = loadWorker(async () => {
			if (mode === "throw") throw new TypeError("Load failed");
			return new Response("gateway", { status: mode });
		});
		await w.lifecycle("install");
		for (const m of ["throw", 502, 504] as const) {
			mode = m;
			const res = await w.dispatch("/program", { mode: "navigate" });
			assert.match(await res!.text(), /Can't reach your PC/, `mode ${m}`);
		}
		mode = 500; // the app's own errors are the app's to show
		assert.equal((await w.dispatch("/program", { mode: "navigate" }))!.status, 500);
	});

	it("static assets are cache-first and only successful responses are stored", async () => {
		let calls = 0;
		let status = 404;
		// Same-origin browser fetches are type "basic"; Node's Response is "default".
		const basic = (res: Response) => Object.defineProperty(res, "type", { value: "basic" });
		const w = loadWorker(async () => (calls++, basic(new Response("js", { status }))));
		await w.dispatch("/_next/static/chunks/a.js");
		status = 200;
		await w.dispatch("/_next/static/chunks/a.js"); // 404 wasn't cached → network again
		const res = await w.dispatch("/_next/static/chunks/a.js"); // now from cache
		assert.equal(await res!.text(), "js");
		assert.equal(calls, 2);
	});

	it("activate drops caches from older worker versions only", async () => {
		const w = loadWorker(async () => new Response("x"));
		w.stores.set("lh-static-v0", new Map());
		w.stores.set("someone-else", new Map());
		await w.lifecycle("install");
		await w.lifecycle("activate");
		assert.deepEqual([...w.stores.keys()].sort(), ["lh-shell-v1", "someone-else"]);
	});
});

describe("service worker registration gate", () => {
	it("registers only on https, in production, outside Electron", () => {
		assert.equal(wantsServiceWorker({ production: true, protocol: "https:", electron: false }), true);
		assert.equal(wantsServiceWorker({ production: true, protocol: "http:", electron: false }), false);
		assert.equal(wantsServiceWorker({ production: false, protocol: "https:", electron: false }), false);
		assert.equal(wantsServiceWorker({ production: true, protocol: "https:", electron: true }), false);
	});
});
