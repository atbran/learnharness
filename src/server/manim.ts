/**
 * Local Manim rendering for lesson explainer animations: manim/.venv (set up
 * by scripts/setup-manim.ps1) renders one scene file to MP4 in a temp dir.
 * Optional: manimStatus() says whether it is installed and whether LaTeX
 * (MiKTeX) is there for MathTex.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import type { ManimRenderResult } from "../agent/subagents/manim-builder.ts";

const PYTHON = path.join(PATHS.root, "manim", ".venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
const MIKTEX_BIN = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "MiKTeX", "miktex", "bin", "x64");
/** Check renders run at 480p15 (fast); the delivered cut at 720p30. */
const QUALITY = { check: { flag: "-ql", timeoutMs: 4 * 60_000 }, final: { flag: "-qm", timeoutMs: 10 * 60_000 } } as const;

function onPath(exe: string): boolean {
	const names = process.platform === "win32" ? [`${exe}.exe`, `${exe}.cmd`] : [exe];
	return (process.env.PATH ?? "").split(path.delimiter).some((dir) => dir && names.some((n) => fs.existsSync(path.join(dir, n))));
}

export function manimStatus(): { available: boolean; latex: boolean; reason?: string } {
	if (!fs.existsSync(PYTHON)) return { available: false, latex: false, reason: "Manim isn't installed — run scripts/setup-manim.ps1." };
	if (!onPath("ffmpeg")) return { available: false, latex: false, reason: "ffmpeg isn't on PATH." };
	return { available: true, latex: fs.existsSync(path.join(MIKTEX_BIN, "latex.exe")) || onPath("latex") };
}

function renderEnv(): NodeJS.ProcessEnv {
	const PATH = fs.existsSync(MIKTEX_BIN) ? `${MIKTEX_BIN}${path.delimiter}${process.env.PATH ?? ""}` : process.env.PATH;
	return { ...process.env, PATH, NO_COLOR: "1", TERM: "dumb", COLUMNS: "160", PYTHONIOENCODING: "utf-8" };
}

function findMp4(dir: string): string | null {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "partial_movie_files") continue;
			const hit = findMp4(p);
			if (hit) return hit;
		} else if (entry.name.endsWith(".mp4")) return p;
	}
	return null;
}

function duration(file: string): number {
	const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
	return Number.parseFloat(r.stdout) || 0;
}

/** A scratch dir for one build; each render gets its own subdir. */
export function manimWorkDir(): string {
	// The long path: Windows' 8.3 temp path (C:\Users\ABCDEF~1\...) has a
	// "~", which LaTeX reads as a special character, so MathTex fails.
	const dir = path.join(fs.realpathSync.native(os.tmpdir()), "lh-manim", randomUUID().slice(0, 8));
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** Render `script` (class Explainer) under `workDir`. */
export function renderManimScene(workDir: string, script: string, quality: keyof typeof QUALITY = "check"): Promise<ManimRenderResult> {
	const { flag, timeoutMs } = QUALITY[quality];
	const started = Date.now();
	const dir = path.join(workDir, randomUUID().slice(0, 6));
	fs.mkdirSync(dir, { recursive: true });
	const scene = path.join(dir, "scene.py");
	fs.writeFileSync(scene, script);
	return new Promise((resolve) => {
		let out = "";
		const child = spawn(PYTHON, ["-m", "manim", "render", flag, "--progress_bar", "none", "--disable_caching", "--media_dir", path.join(dir, "media"), "-o", "explainer", scene, "Explainer"], {
			cwd: dir,
			env: renderEnv(),
			windowsHide: true,
		});
		const keep = (b: Buffer) => {
			out = (out + b.toString("utf8")).slice(-20_000);
		};
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		const timer = setTimeout(() => {
			child.kill();
			keep(Buffer.from(`\nTimed out after ${timeoutMs / 60_000} minutes. Rendering is too slow: don't rebuild MathTex/Tex inside always_redraw or updaters, and keep the scene under ~75 s.`));
		}, timeoutMs);
		const done = (code: number | null) => {
			clearTimeout(timer);
			const log = out.replace(/\x1b\[[0-9;]*m/g, "").trim().slice(-4000);
			const file = code === 0 ? findMp4(path.join(dir, "media")) : null;
			const renderSeconds = (Date.now() - started) / 1000;
			resolve(file ? { ok: true, log, file, seconds: duration(file), renderSeconds } : { ok: false, log: log || `manim exited with code ${code}`, renderSeconds });
		};
		child.on("error", (err) => {
			keep(Buffer.from(String(err)));
			done(null);
		});
		child.on("close", done);
	});
}
