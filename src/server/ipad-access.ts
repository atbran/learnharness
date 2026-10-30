/**
 * iPad access: drive `tailscale serve` for LearnHarness's own port, keep
 * the saved config (data/ipad-access.json), and authorize requests that
 * arrive over the tailnet. Other serve entries on the PC are never touched:
 * only `--https=<our port>` is ever set or turned off, never `serve reset`.
 */

import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import {
	DEFAULT_IPAD_CONFIG,
	IPAD_LOCAL_PORT,
	IPAD_TARGET,
	decodeHeaderWord,
	forwardedIp,
	parseServeStatus,
	parseTailscaleStatus,
	parseWhoisLogin,
	portConflict,
	serveEnableLink,
	servesUs,
	validPort,
	type IpadAccessConfig,
	type ServeEntry,
	type TailscaleSelf,
} from "../core/ipad-access.ts";

const CONFIG_FILE = path.join(PATHS.data, "ipad-access.json");

// ─── Config ─────────────────────────────────────────────────────────────────

let cached: { mtime: number; config: IpadAccessConfig } | null = null;

export function readIpadConfig(): IpadAccessConfig {
	let mtime = 0;
	try {
		mtime = fs.statSync(CONFIG_FILE).mtimeMs;
	} catch {
		return DEFAULT_IPAD_CONFIG;
	}
	if (cached?.mtime === mtime) return cached.config;
	try {
		const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<IpadAccessConfig>;
		const config: IpadAccessConfig = {
			enabled: raw.enabled === true,
			port: validPort(raw.port) ? raw.port : DEFAULT_IPAD_CONFIG.port,
			owner: typeof raw.owner === "string" ? raw.owner : null,
			host: typeof raw.host === "string" ? raw.host : null,
		};
		cached = { mtime, config };
		return config;
	} catch {
		return DEFAULT_IPAD_CONFIG;
	}
}

function writeIpadConfig(config: IpadAccessConfig): void {
	fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
	const tmp = `${CONFIG_FILE}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
	fs.renameSync(tmp, CONFIG_FILE);
	cached = null;
}

// ─── Tailscale CLI ──────────────────────────────────────────────────────────

export function findTailscale(): string | null {
	// The tailscale binary lives outside the project: keep the build's file
	// tracer off these lookups (turbopackIgnore) or it bundles the whole repo.
	const windowsDefault = path.join(/*turbopackIgnore: true*/ process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe");
	const names = process.platform === "win32" ? ["tailscale.exe"] : ["tailscale"];
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		for (const n of names) {
			const p = dir && path.join(/*turbopackIgnore: true*/ dir, n);
			if (p && fs.existsSync(/*turbopackIgnore: true*/ p)) return p;
		}
	}
	return process.platform === "win32" && fs.existsSync(/*turbopackIgnore: true*/ windowsDefault) ? windowsDefault : null;
}

function cli(args: string[], timeout = 10_000): Promise<string> {
	const bin = findTailscale();
	if (!bin) return Promise.reject(new Error("Tailscale isn't installed on this PC."));
	return new Promise((resolve, reject) => {
		execFile(/*turbopackIgnore: true*/ bin, args, { windowsHide: true, timeout, killSignal: "SIGKILL", maxBuffer: 1 << 20 }, (error, stdout, stderr) =>
			error ? reject(new Error((stderr || error.message).trim())) : resolve(stdout),
		);
	});
}

async function cliJson(args: string[]): Promise<unknown> {
	return JSON.parse(await cli(args)) as unknown;
}

export const tailscaleSelf = async (): Promise<TailscaleSelf> => parseTailscaleStatus(await cliJson(["status", "--json"]));
export const serveEntries = async (): Promise<ServeEntry[]> => parseServeStatus(await cliJson(["serve", "status", "--json"]));

/** Run `tailscale serve --bg` for our port. The CLI can block waiting for
 *  the tailnet admin to enable serve/HTTPS; it then prints a link, which
 *  is returned instead of waiting. */
function runServe(port: number): Promise<{ ok: true } | { ok: false; link: string | null; error: string }> {
	const bin = findTailscale();
	if (!bin) return Promise.resolve({ ok: false, link: null, error: "Tailscale isn't installed on this PC." });
	return new Promise((resolve) => {
		const child = spawn(/*turbopackIgnore: true*/ bin, ["serve", "--bg", "--yes", `--https=${port}`, IPAD_TARGET], { windowsHide: true });
		let out = "";
		let settled = false;
		const finish = (r: { ok: true } | { ok: false; link: string | null; error: string }) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill();
			resolve(r);
		};
		const onData = (d: Buffer) => {
			out += d.toString();
			const link = serveEnableLink(out);
			if (link) finish({ ok: false, link, error: "Serve isn't enabled for your tailnet yet." });
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);
		child.on("error", (e) => finish({ ok: false, link: null, error: e.message }));
		child.on("exit", (code) => finish(code === 0 ? { ok: true } : { ok: false, link: serveEnableLink(out), error: out.trim() || `tailscale exited with ${code}` }));
		const timer = setTimeout(() => finish({ ok: false, link: serveEnableLink(out), error: "tailscale serve didn't finish within 30 s." }), 30_000);
	});
}

// ─── Status / enable / disable ──────────────────────────────────────────────

export interface IpadStatus {
	installed: boolean;
	backendState: string | null;
	owner: string | null;
	host: string | null;
	config: IpadAccessConfig;
	/** Every serve port on the PC (so the UI can show what's taken). */
	ports: ServeEntry[];
	/** Our entry is live in Tailscale. */
	serving: boolean;
	url: string | null;
	localPort: number;
	error: string | null;
}

export async function ipadStatus(): Promise<IpadStatus> {
	const config = readIpadConfig();
	const base: IpadStatus = {
		installed: !!findTailscale(),
		backendState: null,
		owner: null,
		host: null,
		config,
		ports: [],
		serving: false,
		url: null,
		localPort: IPAD_LOCAL_PORT,
		error: null,
	};
	if (!base.installed) return base;
	try {
		const self = await tailscaleSelf();
		const ports = self.backendState === "Running" ? await serveEntries() : [];
		const serving = servesUs(ports, config.port);
		return {
			...base,
			backendState: self.backendState,
			owner: self.owner,
			host: self.host,
			ports,
			serving,
			url: self.host ? `https://${self.host}${config.port === 443 ? "" : `:${config.port}`}/program` : null,
		};
	} catch (err) {
		return { ...base, error: err instanceof Error ? err.message : String(err) };
	}
}

export type IpadChange = { ok: true; status: IpadStatus } | { ok: false; error: string; link?: string | null; status: IpadStatus };

export async function setIpadAccess(enabled: boolean, port: number): Promise<IpadChange> {
	if (!validPort(port)) return { ok: false, error: "Pick a port between 1 and 65535.", status: await ipadStatus() };
	const current = readIpadConfig();
	if (!enabled) {
		const ports = await serveEntries().catch(() => [] as ServeEntry[]);
		// Only ever turn off an entry that is ours.
		if (servesUs(ports, current.port)) await cli(["serve", `--https=${current.port}`, "off"]);
		writeIpadConfig({ ...current, enabled: false });
		return { ok: true, status: await ipadStatus() };
	}
	const self = await tailscaleSelf().catch(() => null);
	if (!self || self.backendState !== "Running") return { ok: false, error: "Tailscale isn't running or signed in on this PC.", status: await ipadStatus() };
	if (!self.owner || !self.host) return { ok: false, error: "Couldn't read this PC's Tailscale user and name.", status: await ipadStatus() };
	const ports = await serveEntries();
	const taken = portConflict(ports, port);
	if (taken) return { ok: false, error: `Port ${port} is already used by another app (${taken.proxy ?? "TCP forward"}). Pick a different port.`, status: await ipadStatus() };
	// Moving to a new port: free our old one first.
	if (current.port !== port && servesUs(ports, current.port)) await cli(["serve", `--https=${current.port}`, "off"]);
	const served = await runServe(port);
	if (!served.ok) return { ok: false, error: served.error, link: served.link, status: await ipadStatus() };
	writeIpadConfig({ enabled: true, port, owner: self.owner, host: self.host });
	return { ok: true, status: await ipadStatus() };
}

// ─── Request authorization ──────────────────────────────────────────────────

const whoisCache = new Map<string, { login: string | null; at: number }>();
const WHOIS_TTL = 5 * 60_000;

async function whoisLogin(ip: string): Promise<string | null> {
	const hit = whoisCache.get(ip);
	if (hit && Date.now() - hit.at < WHOIS_TTL) return hit.login;
	const login = await cliJson(["whois", "--json", ip]).then(parseWhoisLogin, () => null);
	whoisCache.set(ip, { login, at: Date.now() });
	return login;
}

/** A request that came in over the tailnet may proceed only when iPad
 *  access is on and it is the PC's own Tailscale user — by serve's
 *  identity header AND by asking tailscaled who owns the source address
 *  (a local process could fake the header, not the whois). */
export async function tailnetAuthorized(headers: Headers): Promise<boolean> {
	const config = readIpadConfig();
	if (!config.enabled || !config.owner) return false;
	const login = headers.get("tailscale-user-login");
	const ip = forwardedIp(headers);
	if (!login || !ip || decodeHeaderWord(login) !== config.owner) return false;
	return (await whoisLogin(ip)) === config.owner;
}
