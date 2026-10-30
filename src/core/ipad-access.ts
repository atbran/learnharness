/**
 * iPad access, pure part: reading the Tailscale CLI's JSON, the serve-port
 * conflict rule, and the tailnet request check. The CLI calls and the
 * saved config live in src/server/ipad-access.ts.
 *
 * The iPad reaches the PC through `tailscale serve`, which proxies
 * https://<machine>.<tailnet>.ts.net:<port> to the app on loopback. Serve
 * keeps the Host header, adds X-Forwarded-For (the client's tailnet IP),
 * and injects Tailscale-User-Login after stripping any copy the client sent.
 */

/** The launcher's fixed loopback port (scripts/pc.mjs). */
export const IPAD_LOCAL_PORT = 3217;
/** The tailnet HTTPS port LearnHarness serves on unless changed. */
export const IPAD_DEFAULT_PORT = 8444;
export const IPAD_TARGET = `http://127.0.0.1:${IPAD_LOCAL_PORT}`;

export interface IpadAccessConfig {
	enabled: boolean;
	port: number;
	/** The tailnet login allowed in (the PC's own Tailscale user). */
	owner: string | null;
	/** The PC's MagicDNS name, e.g. desktop-x.tail1234.ts.net. */
	host: string | null;
}

export const DEFAULT_IPAD_CONFIG: IpadAccessConfig = { enabled: false, port: IPAD_DEFAULT_PORT, owner: null, host: null };

/** One HTTPS/TCP port the PC's serve config uses, and where it proxies
 *  (null for a raw TCP forward or a non-proxy handler). */
export interface ServeEntry {
	port: number;
	proxy: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

/** `tailscale serve status --json` → the ports in use. */
export function parseServeStatus(raw: unknown): ServeEntry[] {
	const status = obj(raw);
	const byPort = new Map<number, string | null>();
	for (const port of Object.keys(obj(status.TCP))) {
		const n = Number(port);
		if (Number.isInteger(n)) byPort.set(n, null);
	}
	for (const [hostPort, site] of Object.entries(obj(status.Web))) {
		const n = Number(hostPort.split(":").at(-1));
		if (!Number.isInteger(n)) continue;
		const root = obj(obj(obj(site).Handlers)["/"]);
		byPort.set(n, typeof root.Proxy === "string" ? root.Proxy : null);
	}
	return [...byPort].map(([port, proxy]) => ({ port, proxy })).sort((a, b) => a.port - b.port);
}

/** Proxies count as the same target whatever the spelling (localhost vs
 *  127.0.0.1, trailing slash). */
function sameTarget(a: string, b: string): boolean {
	const norm = (s: string) => s.trim().replace(/\/+$/, "").replace("://localhost:", "://127.0.0.1:");
	return norm(a) === norm(b);
}

/** The entry already on `port` that isn't LearnHarness's, if any: serving
 *  there would take it over from another app. */
export function portConflict(entries: readonly ServeEntry[], port: number, target = IPAD_TARGET): ServeEntry | null {
	const hit = entries.find((e) => e.port === port);
	return hit && !(hit.proxy && sameTarget(hit.proxy, target)) ? hit : null;
}

export function servesUs(entries: readonly ServeEntry[], port: number, target = IPAD_TARGET): boolean {
	const hit = entries.find((e) => e.port === port);
	return !!hit?.proxy && sameTarget(hit.proxy, target);
}

export function validPort(port: unknown): port is number {
	return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export interface TailscaleSelf {
	/** "Running", "NeedsLogin", "Stopped", … */
	backendState: string;
	host: string | null;
	owner: string | null;
}

/** `tailscale status --json` → state, MagicDNS name, signed-in login. */
export function parseTailscaleStatus(raw: unknown): TailscaleSelf {
	const status = obj(raw);
	const self = obj(status.Self);
	const dns = typeof self.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "";
	const user = obj(obj(status.User)[String(self.UserID)]);
	return {
		backendState: typeof status.BackendState === "string" ? status.BackendState : "Unknown",
		host: dns || null,
		owner: typeof user.LoginName === "string" ? user.LoginName : null,
	};
}

/** `tailscale whois --json <ip>` → the login behind that tailnet address. */
export function parseWhoisLogin(raw: unknown): string | null {
	const login = obj(obj(raw).UserProfile).LoginName;
	return typeof login === "string" && login ? login : null;
}

/** The "enable HTTPS / serve on your tailnet" link the CLI prints when the
 *  feature is off for the tailnet. */
export function serveEnableLink(output: string): string | null {
	return /https:\/\/login\.tailscale\.com\/\S+/.exec(output)?.[0] ?? null;
}

/** RFC 2047 encoded-words, as serve sends non-ASCII logins/names
 *  (`=?utf-8?q?...?=`, `=?utf-8?b?...?=`); plain values pass through. */
export function decodeHeaderWord(value: string): string {
	return value.replace(/=\?([^?]+)\?([qQbB])\?([^?]*)\?=/g, (_, _charset: string, enc: string, text: string) => {
		const bytes =
			enc.toLowerCase() === "b"
				? Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
				: Uint8Array.from(
						text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})|[\s\S]/g, (m, hex: string | undefined) => (hex ? String.fromCharCode(parseInt(hex, 16)) : m)),
						(c) => c.charCodeAt(0),
					);
		return new TextDecoder().decode(bytes);
	});
}

interface HeaderBag {
	get(name: string): string | null;
}

const isLoopback = (ip: string) => /^(127\.|::1$|::ffff:127\.)/.test(ip);

/** Did this request come in over the tailnet (through serve) rather than
 *  from the PC's own browser? Any one sign is enough: a request that only
 *  looks local must not be able to skip the check by dropping a header.
 *  (Next itself fills X-Forwarded-For with the socket address — loopback,
 *  since the server binds 127.0.0.1 — so only a non-loopback one counts;
 *  serve sets it to the iPad's tailnet IP.) */
export function isTailnetRequest(headers: HeaderBag): boolean {
	const host = (headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
	const ip = forwardedIp(headers);
	return host.endsWith(".ts.net") || (ip !== null && !isLoopback(ip)) || headers.get("tailscale-user-login") !== null;
}

/** The serve-supplied client IP (serve sets exactly one). */
export function forwardedIp(headers: HeaderBag): string | null {
	const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return ip || null;
}
