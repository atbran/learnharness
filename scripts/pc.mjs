/**
 * pc.mjs — run LearnHarness on this PC for the browser and the iPad.
 *
 *   npm run pc
 *
 * Builds only when the sources are newer than the last build, then serves
 * the production app on 127.0.0.1:3217 (loopback only: the iPad reaches it
 * through Tailscale serve, never over the Wi-Fi) and opens the browser.
 * The port is fixed because the Tailscale entry points at it.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOST = "127.0.0.1";
const PORT = 3217;
const URL = `http://localhost:${PORT}/program`;
const NEXT = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const BUILD_ID = path.join(ROOT, ".next", "BUILD_ID");

// Build inputs. The curriculum and data/ are read at runtime, so they don't count.
const SOURCE_DIRS = ["app", "components", "lib", "src", "public"];
const SOURCE_FILES = ["next.config.ts", "config.ts", "proxy.ts", "package-lock.json", "tsconfig.json", "postcss.config.mjs"];

function newestMtime(p) {
	let stat;
	try {
		stat = fs.statSync(p);
	} catch {
		return 0;
	}
	if (!stat.isDirectory()) return stat.mtimeMs;
	let newest = 0;
	for (const entry of fs.readdirSync(p)) newest = Math.max(newest, newestMtime(path.join(p, entry)));
	return newest;
}

function needsBuild() {
	if (!fs.existsSync(BUILD_ID)) return true;
	const built = fs.statSync(BUILD_ID).mtimeMs;
	const sources = Math.max(...SOURCE_DIRS.map((d) => newestMtime(path.join(ROOT, d))), ...SOURCE_FILES.map((f) => newestMtime(path.join(ROOT, f))));
	return sources > built;
}

function run(args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [NEXT, ...args], { cwd: ROOT, stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next ${args[0]} exited with ${code}`))));
	});
}

function portFree() {
	return new Promise((resolve) => {
		const srv = net.createServer();
		srv.once("error", () => resolve(false));
		srv.listen(PORT, HOST, () => srv.close(() => resolve(true)));
	});
}

/** Is the thing already on the port LearnHarness? */
function isLearnHarness() {
	return new Promise((resolve) => {
		const req = http.get({ host: HOST, port: PORT, path: "/api/program", timeout: 3000 }, (res) => {
			res.resume();
			resolve(res.statusCode === 200);
		});
		req.on("error", () => resolve(false));
		req.on("timeout", () => req.destroy());
	});
}

function openBrowser() {
	const [cmd, args] =
		process.platform === "win32" ? ["cmd", ["/c", "start", "", URL]] : process.platform === "darwin" ? ["open", [URL]] : ["xdg-open", [URL]];
	spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).unref();
}

function waitUntilUp(tries = 150) {
	return new Promise((resolve, reject) => {
		const attempt = (n) =>
			isLearnHarness().then((up) => {
				if (up) resolve();
				else if (n <= 0) reject(new Error("the server didn't come up"));
				else setTimeout(() => attempt(n - 1), 400);
			});
		attempt(tries);
	});
}

if (!(await portFree())) {
	if (await isLearnHarness()) {
		console.log(`LearnHarness is already running on port ${PORT}; opening it.`);
		openBrowser();
		process.exit(0);
	}
	console.error(`Port ${PORT} is in use by something else. LearnHarness needs that port (the iPad's Tailscale entry points at it).`);
	console.error(`Find it with:  netstat -ano | findstr :${PORT}`);
	process.exit(1);
}

if (needsBuild()) {
	console.log("Sources changed since the last build; building (a few minutes)...");
	await run(["build"]);
} else {
	console.log("Build is up to date.");
}

const server = spawn(process.execPath, [NEXT, "start", "-H", HOST, "-p", String(PORT)], { cwd: ROOT, stdio: "inherit" });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));

await waitUntilUp();
console.log(`\nLearnHarness is running at ${URL}  (close this window to stop it)\n`);
openBrowser();
