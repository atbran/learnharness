/**
 * iPad access — Tailscale JSON parsing, the "never take another app's
 * port" rule, encoded identity headers, and the proxy's tailnet gate.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { PATHS } from "../config.ts";
import {
	IPAD_TARGET,
	decodeHeaderWord,
	forwardedIp,
	isTailnetRequest,
	parseServeStatus,
	parseTailscaleStatus,
	parseWhoisLogin,
	portConflict,
	serveEnableLink,
	servesUs,
} from "../src/core/ipad-access.ts";
import { proxy } from "../proxy.ts";

// The user's real serve config at the time of writing: three other apps.
const SERVE = {
	TCP: { "10000": { HTTPS: true }, "443": { HTTPS: true }, "8443": { HTTPS: true } },
	Web: {
		"pc.tail1.ts.net:10000": { Handlers: { "/": { Proxy: "http://127.0.0.1:8799" } } },
		"pc.tail1.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
		"pc.tail1.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4317" } } },
	},
};

test("serve status parses to ports; other apps' ports are conflicts, ours and free ones aren't", () => {
	const entries = parseServeStatus(SERVE);
	assert.deepEqual(entries, [
		{ port: 443, proxy: "http://127.0.0.1:3000" },
		{ port: 8443, proxy: "http://127.0.0.1:4317" },
		{ port: 10000, proxy: "http://127.0.0.1:8799" },
	]);
	for (const port of [443, 8443, 10000]) assert.ok(portConflict(entries, port), `port ${port} belongs to another app`);
	assert.equal(portConflict(entries, 8444), null);
	const withUs = parseServeStatus({ ...SERVE, Web: { ...SERVE.Web, "pc.tail1.ts.net:8444": { Handlers: { "/": { Proxy: "http://localhost:3217/" } } } } });
	assert.equal(portConflict(withUs, 8444), null, "our own entry (any spelling) is not a conflict");
	assert.ok(servesUs(withUs, 8444));
	assert.ok(!servesUs(entries, 8444));
	// A raw TCP forward with no web handler still occupies the port.
	assert.ok(portConflict(parseServeStatus({ TCP: { "9000": { TCPForward: "127.0.0.1:22" } } }), 9000));
	assert.deepEqual(parseServeStatus(null), []);
	assert.equal(IPAD_TARGET, "http://127.0.0.1:3217");
});

test("tailscale status / whois / enable-link parsing", () => {
	const self = parseTailscaleStatus({
		BackendState: "Running",
		Self: { DNSName: "desktop-x.tail1.ts.net.", UserID: 42 },
		User: { "42": { LoginName: "me@example.com" } },
	});
	assert.deepEqual(self, { backendState: "Running", host: "desktop-x.tail1.ts.net", owner: "me@example.com" });
	assert.deepEqual(parseTailscaleStatus({}), { backendState: "Unknown", host: null, owner: null });
	assert.equal(parseWhoisLogin({ UserProfile: { LoginName: "me@example.com" } }), "me@example.com");
	assert.equal(parseWhoisLogin({}), null);
	assert.equal(
		serveEnableLink("Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc123\n"),
		"https://login.tailscale.com/f/serve?node=abc123",
	);
	assert.equal(serveEnableLink("Available within your tailnet: https://pc.tail1.ts.net:8444/"), null);
});

test("encoded identity headers decode; plain ones pass through", () => {
	assert.equal(decodeHeaderWord("me@example.com"), "me@example.com");
	assert.equal(decodeHeaderWord("=?utf-8?q?Ren=C3=A9_Dupont?="), "René Dupont");
	assert.equal(decodeHeaderWord("=?utf-8?b?UmVuw6k=?="), "René");
});

test("tailnet requests are recognised by any sign; a plain local request isn't", () => {
	const h = (o: Record<string, string>) => new Headers(o);
	assert.ok(!isTailnetRequest(h({ host: "localhost:3217" })));
	// Next fills X-Forwarded-For with the (loopback) socket address itself.
	for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.ok(!isTailnetRequest(h({ host: "localhost:3217", "x-forwarded-for": ip })), ip);
	assert.ok(isTailnetRequest(h({ host: "localhost:3217", "x-forwarded-for": "fd7a:115c:a1e0::5" })));
	assert.ok(isTailnetRequest(h({ host: "pc.tail1.ts.net:8444" })));
	assert.ok(isTailnetRequest(h({ host: "localhost:3217", "x-forwarded-for": "100.64.0.5" })));
	assert.ok(isTailnetRequest(h({ host: "localhost:3217", "tailscale-user-login": "me@example.com" })));
	assert.equal(forwardedIp(h({ "x-forwarded-for": "100.64.0.5, 10.0.0.1" })), "100.64.0.5");
	assert.equal(forwardedIp(h({})), null);
});

// This test rewrites and deletes data/ipad-access.json: only ever against a
// test data dir (npm test sets LH_DATA_DIR), never the learner's real config.
test("proxy: tailnet requests are refused while iPad access is off or the identity is wrong; local pages pass", { skip: process.env.LH_DATA_DIR ? false : "needs LH_DATA_DIR (it rewrites ipad-access.json)" }, async () => {
	const configFile = path.join(PATHS.data, "ipad-access.json");
	fs.rmSync(configFile, { force: true });
	const tailnet = { host: "pc.tail1.ts.net:8444", "x-forwarded-for": "100.64.0.5", "tailscale-user-login": "me@example.com" };
	assert.equal((await proxy(new NextRequest("http://pc.tail1.ts.net:8444/program", { headers: tailnet }))).status, 403, "off by default");
	assert.equal((await proxy(new NextRequest("http://pc.tail1.ts.net:8444/_next/static/x.js", { headers: tailnet }))).status, 403, "static files too");
	try {
		fs.mkdirSync(PATHS.data, { recursive: true });
		fs.writeFileSync(configFile, JSON.stringify({ enabled: true, port: 8444, owner: "me@example.com", host: "pc.tail1.ts.net" }));
		const wrongUser = { ...tailnet, "tailscale-user-login": "someone@else.com" };
		assert.equal((await proxy(new NextRequest("http://pc.tail1.ts.net:8444/program", { headers: wrongUser }))).status, 403);
		const noIp = { host: tailnet.host, "tailscale-user-login": tailnet["tailscale-user-login"] };
		assert.equal((await proxy(new NextRequest("http://pc.tail1.ts.net:8444/program", { headers: noIp }))).status, 403, "the header alone isn't enough");
		// The right header but a whois that can't confirm it (no tailnet here): refused.
		assert.equal((await proxy(new NextRequest("http://pc.tail1.ts.net:8444/program", { headers: tailnet }))).status, 403);
	} finally {
		fs.rmSync(configFile, { force: true });
	}
	assert.equal((await proxy(new NextRequest("http://localhost:3217/program"))).headers.get("x-middleware-next"), "1");
});
