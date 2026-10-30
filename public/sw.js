/* LearnHarness service worker — the iPad home-screen companion.
 *
 * Registered by components/sw-register.tsx ONLY on https (the Tailscale
 * serve origin) in production builds, never inside Electron. Its whole job:
 *   1. /_next/static/* (content-hashed, immutable build assets) → cache-first,
 *      so the app's JS/CSS loads fast over the tailnet.
 *   2. Page navigations → network ONLY (pages carry user data; nothing HTML is
 *      ever cached). When the PC can't be reached — a network error, a
 *      gateway error from Tailscale serve (502/504: LearnHarness not running),
 *      or no response headers within NAV_TIMEOUT_MS — show /offline.html.
 *   3. Everything else, above all /api/* (including the SSE streams
 *      /api/events and /api/program/events), RSC/data fetches and non-GET
 *      requests → untouched: the worker never calls respondWith, so the
 *      browser handles them exactly as if no worker existed.
 *
 * Bump VERSION when this file's caching behavior or offline.html changes;
 * activate() deletes every cache that isn't the current version's.
 */

const VERSION = "v1";
const SHELL_CACHE = "lh-shell-" + VERSION;
const STATIC_CACHE = "lh-static-" + VERSION;
const OFFLINE_URL = "/offline.html";
// offline.html is self-contained (inline CSS, no images): nothing else to precache.
const SHELL_URLS = [OFFLINE_URL];
// Old builds' hashed chunks pile up in STATIC_CACHE; trim the oldest beyond this.
const STATIC_MAX_ENTRIES = 400;
const NAV_TIMEOUT_MS = 20000;

/** Pure routing decision (unit-tested in tests/service-worker.test.ts).
 * @param {{ method: string, url: string, mode: string, accept: string }} req
 * @param {string} origin the worker's own origin
 * @returns {"static" | "navigate" | "passthrough"} */
function lhRoute(req, origin) {
	if (req.method !== "GET") return "passthrough";
	let url;
	try {
		url = new URL(req.url);
	} catch {
		return "passthrough";
	}
	if (url.origin !== origin) return "passthrough";
	const path = url.pathname;
	// Never touch the API (user data, SSE) — not even for navigations to it.
	if (path === "/api" || path.startsWith("/api/")) return "passthrough";
	if ((req.accept || "").includes("text/event-stream")) return "passthrough";
	if (path.startsWith("/_next/static/")) return "static";
	if (req.mode === "navigate") return "navigate";
	return "passthrough";
}

/** Gateway errors mean Tailscale serve answered but LearnHarness didn't. */
function lhIsUnreachableStatus(status) {
	return status === 502 || status === 504;
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			.then((cache) => cache.addAll(SHELL_URLS.map((u) => new Request(u, { cache: "reload" }))))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k.startsWith("lh-") && k !== SHELL_CACHE && k !== STATIC_CACHE)
						.map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const req = event.request;
	const route = lhRoute(
		{ method: req.method, url: req.url, mode: req.mode, accept: req.headers.get("accept") || "" },
		self.location.origin,
	);
	if (route === "static") event.respondWith(cacheFirst(event, req));
	else if (route === "navigate") event.respondWith(navigate(req));
	// passthrough: no respondWith → default browser networking.
});

async function cacheFirst(event, req) {
	const cache = await caches.open(STATIC_CACHE);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	if (res.ok && res.type === "basic") {
		const copy = res.clone();
		event.waitUntil(cache.put(req, copy).then(() => trim(cache)));
	}
	return res;
}

async function trim(cache) {
	const keys = await cache.keys();
	const excess = keys.length - STATIC_MAX_ENTRIES;
	for (let i = 0; i < excess; i++) {
		const key = keys[i];
		if (key) await cache.delete(key);
	}
}

async function navigate(req) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
	try {
		// Timeout covers only the wait for response headers; the body streams freely.
		const res = await fetch(req, { signal: controller.signal });
		if (!lhIsUnreachableStatus(res.status)) return res;
	} catch {
		// Network error / abort → offline page below.
	} finally {
		clearTimeout(timer);
	}
	const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
	return (
		offline ||
		new Response("Can't reach your PC. Is Tailscale on, and is LearnHarness running on the PC?", {
			status: 503,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		})
	);
}
