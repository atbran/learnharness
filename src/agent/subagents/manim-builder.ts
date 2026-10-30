import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";
import { healToolRecord } from "../tools/heal.ts";

/**
 * The Manim explainer builder: given a brief it writes ONE Manim Community
 * scene (class Explainer), renders it locally, and on a render error reads
 * the traceback and fixes the scene, re-rendering until it renders clean. The
 * renderer is injected (the server spawns manim in manim/.venv; tests use a
 * fake), so this module never touches Python itself.
 *
 * Same verify gate as the demo builder: the delivered script is the one the
 * last successful render used; anything else is a failure with a reason.
 */

export interface ManimRenderResult {
	ok: boolean;
	/** On failure: the tail of manim's stderr/stdout (the traceback). */
	log: string;
	/** On success: the rendered MP4 (absolute path) and its duration. */
	file?: string;
	seconds?: number;
	/** Wall-clock render time. */
	renderSeconds?: number;
}

export interface ManimBuilderInput {
	title: string;
	brief: string;
	/** LaTeX is installed: MathTex/Tex are allowed. */
	latex: boolean;
}

export interface ManimBuilderOptions {
	engine?: PiEngine;
	render: (script: string) => Promise<ManimRenderResult>;
	/** Max agent steps (each write/render is one). Default 16 ≈ 4 fix cycles. */
	maxSteps?: number;
	onActivity?: (line: string) => void;
}

export type ManimBuilderResult = { ok: true; script: string; file: string; seconds: number; notes?: string } | { ok: false; reason: string };

export function manimInstructions(latex: boolean): string {
	return `You are an explainer animator: a specialist sub-agent that writes ONE short Manim Community (v0.22)
animation for a physics lesson, in the visual style of a 3Blue1Brown explainer. You receive a brief; it is
everything you know about the lesson.

The scene contract:
- One Python file: \`from manim import *\` then \`class Explainer(Scene)\` (MovingCameraScene or ThreeDScene are
  fine as the base class; the class name must be Explainer). numpy is available. No other imports, no files,
  images, sounds, or network.
- ${latex ? "LaTeX is installed: use MathTex for equations (raw strings, e.g. MathTex(r\"\\omega_1=\\sqrt{\\omega_0^2-\\beta^2}\"))." : "LaTeX is NOT installed: never use MathTex or Tex. Write equations with Text using Unicode (ω₀, β², √, ·)."}
- 30 to 75 seconds total. It is silent, so short on-screen captions (Text, font_size 28-36) carry the
  narration; fade each caption out before the next appears.
- Teach ONE idea in clear stages: set up the objects, animate the key change (use ValueTracker +
  always_redraw for parameter sweeps), point at what matters, end on a one-line takeaway held ~2 s.
- Keep everything inside the frame (about 14 x 8 units). Arrange with next_to/to_edge/arrange and leave
  margins; never stack text on top of other text. Label axes and quantities with names and units.
- You cannot see the frames, so lay out defensively: give live readouts their own row (never on top of a
  plot title); keep captions to about 55 characters per line (break longer ones into two lines) and call
  .scale_to_fit_width(min(m.width, 13)) on any wide caption or equation.
- Render time matters (it must render in well under 4 minutes at low quality): ${latex ? "MathTex is slow to build, so use it" : "build equations"} only for static
  equations, never inside always_redraw or an updater. For live numbers use DecimalNumber (or Text) and
  update it with .set_value / become on cheap objects. Prefer plot/ParametricFunction over many small mobjects.

THE HOUSE RULE: never deliver unrendered.
1. Call write_scene with the complete file.
2. Call render_scene. It renders a fast low-quality check and reports success (video length, render time) or
   the traceback.
3. On an error, FIX the file, write_scene again, render_scene again. Repeat until it renders.
4. Then finish. Your final message is 1-3 sentences of NOTES for the learner (what the animation shows,
   what to watch for), written to the learner. No build or render details, and NEVER the code itself.`;
}

const ALLOWED_IMPORTS = new Set(["manim", "numpy", "math", "random", "itertools", "functools"]);
const BLOCKED = /\b(__import__|open|exec|eval|compile|subprocess|os|sys|shutil|socket|pathlib|importlib|urllib|requests)\s*[.(]/;

/** Scenes run as unsandboxed local Python, so keep them to drawing code:
 *  allowlisted imports, no file/process/network/eval calls. Not a sandbox,
 *  a guard against a model reaching for the machine. */
export function sceneProblem(code: string): string | null {
	if (!/class\s+Explainer\s*\(/.test(code)) return "the scene class must be named Explainer.";
	for (const m of code.matchAll(/^\s*(?:from|import)\s+([\w.]+)/gm)) {
		const mod = m[1]!.split(".")[0]!;
		if (!ALLOWED_IMPORTS.has(mod)) return `import of "${mod}" is not allowed (only ${[...ALLOWED_IMPORTS].join(", ")}).`;
	}
	const bad = BLOCKED.exec(code.replace(/#.*$/gm, ""));
	if (bad) return `"${bad[1]}" is not allowed in a scene — drawing code only.`;
	return null;
}

interface BuilderState {
	script: string | null;
	rendered: { script: string; file: string; seconds: number } | null;
	lastError: string | null;
}

const writeSceneInput = Type.Object({
	code: Type.String({ description: "The complete Python file: `from manim import *` and `class Explainer(Scene)`." }),
});
const renderSceneInput = Type.Object({});

export function createManimBuilderTools(state: BuilderState, opts: ManimBuilderOptions): Record<string, AgentTool<any>> {
	return healToolRecord({
		write_scene: {
			name: "write_scene",
			label: "write_scene",
			description: "Write the complete Manim scene file (overwrites any previous version). Always follow with render_scene.",
			parameters: writeSceneInput,
			execute: serverExecute("write_scene", writeSceneInput, async ({ code }) => {
				if (!code.trim()) return "ERROR: empty file — write the full scene.";
				const problem = sceneProblem(code);
				if (problem) return `ERROR: ${problem}`;
				state.script = code;
				opts.onActivity?.(`write_scene: ${code.split("\n").length} lines`);
				return "Saved. Now call render_scene — never deliver unrendered.";
			}),
		},
		render_scene: {
			name: "render_scene",
			label: "render_scene",
			description: "Render the current scene with Manim and report success (with its duration) or the error traceback.",
			parameters: renderSceneInput,
			// Not serverExecute: its 30 s tool guard would discard every real
			// render (minutes). The renderer enforces its own timeout.
			execute: async () => ({ content: [{ type: "text", text: await renderScene() }], details: null }),
		},
	});

	async function renderScene(): Promise<string> {
		if (!state.script) return "ERROR: nothing to render — call write_scene first.";
		opts.onActivity?.("render_scene: rendering");
		const script = state.script;
		const r = await opts.render(script);
		if (!r.ok || !r.file) {
			state.lastError = r.log;
			opts.onActivity?.("render_scene: error");
			return `RENDER FAILED. Fix the scene and render again.\n${r.log}`;
		}
		state.rendered = { script, file: r.file, seconds: r.seconds ?? 0 };
		opts.onActivity?.(`render_scene: ok (${Math.round(r.seconds ?? 0)} s)`);
		const len = r.seconds ?? 0;
		const pace = len < 25 ? " It is shorter than 25 s; consider slowing it (wait/run_time) and re-rendering." : len > 90 ? " It is over 90 s; tighten it and re-render." : "";
		const slow = (r.renderSeconds ?? 0) > 120 ? ` Rendering took ${Math.round(r.renderSeconds!)} s, too slow for the final cut: remove per-frame MathTex/Tex rebuilds and re-render.` : "";
		return `RENDERED (${len.toFixed(1)} s of video${r.renderSeconds ? `, rendered in ${Math.round(r.renderSeconds)} s` : ""}).${pace}${slow} If you are satisfied, finish with your notes.`;
	}
}

export async function runManimBuilder(input: ManimBuilderInput, opts: ManimBuilderOptions): Promise<ManimBuilderResult> {
	const state: BuilderState = { script: null, rendered: null, lastError: null };
	const prompt = [
		`Animation title: ${input.title.trim() || "Explainer"}`,
		"Brief (all you know about the lesson — this comes from the teacher, verbatim):",
		input.brief.trim(),
		"",
		"Write the scene, render it with render_scene, fix until it renders, then finish with your notes.",
	].join("\n");

	let finalText = "";
	try {
		const result = await runSubagent(Object.values(createManimBuilderTools(state, opts)), {
			role: "demoBuilder",
			engine: opts.engine,
			systemPrompt: manimInstructions(input.latex),
			prompt,
			maxTurns: opts.maxSteps ?? 16,
			onToolStart: (toolName) => opts.onActivity?.(toolName),
		});
		finalText = result.text;
	} catch (err) {
		return { ok: false, reason: `the builder crashed — ${err instanceof Error ? err.message : String(err)}` };
	}

	if (!state.script) return { ok: false, reason: `the builder never wrote a scene.${finalText ? ` (${finalText.slice(0, 300)})` : ""}` };
	const problem = sceneProblem(state.script);
	if (problem) return { ok: false, reason: problem };

	// The gate: deliver only the script that actually rendered last.
	if (!state.rendered || state.rendered.script !== state.script) {
		opts.onActivity?.("final render");
		const r = await opts.render(state.script);
		if (!r.ok || !r.file) return { ok: false, reason: `the scene never rendered cleanly. Last error:\n${(r.log || state.lastError || "").slice(-1200)}` };
		state.rendered = { script: state.script, file: r.file, seconds: r.seconds ?? 0 };
	}
	return { ok: true, script: state.rendered.script, file: state.rendered.file, seconds: state.rendered.seconds, notes: finalText.trim() || undefined };
}
