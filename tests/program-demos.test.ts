/**
 * program demos — the demo-builder brief, the title derived from a lesson's
 * one-line demo idea, and the Manim explainer builder's scene guard and
 * render/fix gate (scripted engine, fake renderer).
 */
import assert from "node:assert";
import test from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { toolTimeoutMs } from "../src/agent/tool-execute.ts";
import { runManimBuilder, sceneProblem, type ManimRenderResult } from "../src/agent/subagents/manim-builder.ts";
import { demoBrief, demoTitle } from "../src/server/demos.ts";

const ctx = {
	lesson: { title: "Damped oscillations", objectives: ["Solve the damped equation.", "Compute Q."], keyEquations: ["Q=\\omega_0/2\\beta"] },
	course: { code: "P4", title: "Classical Mechanics" },
	unit: { title: "Oscillations" },
};

test("the brief names the audience, objectives, key equations and the idea", () => {
	const brief = demoBrief(ctx, "Damped oscillator with a beta slider.");
	assert.match(brief, /organic chemist learning physics/);
	assert.match(brief, /explicit CSS width and height/);
	assert.match(brief, /P4 Classical Mechanics · Oscillations · Damped oscillations/);
	assert.match(brief, /- Solve the damped equation\.\n- Compute Q\./);
	assert.match(brief, /Key equations \(LaTeX\):\n- Q=\\omega_0\/2\\beta/);
	assert.ok(brief.trimEnd().endsWith("The demo to build:\nDamped oscillator with a beta slider."));
});

test("the brief omits the equations section when there are none", () => {
	const brief = demoBrief({ ...ctx, lesson: { ...ctx.lesson, keyEquations: [] } }, "x");
	assert.doesNotMatch(brief, /Key equations/);
});

test("demo titles are the idea's first clause, trimmed to a word", () => {
	assert.equal(demoTitle("Rocket simulator: choose exhaust speed and mass ratio"), "Rocket simulator");
	assert.equal(demoTitle("Particle on a plane with draggable velocity; show r-hat rotating"), "Particle on a plane");
	assert.equal(demoTitle("Two charges - drag them apart"), "Two charges");
	const long = demoTitle("Interactive U(x) curve over a draggable horizontal energy line marking turning points and forbidden zones");
	assert.ok(long.length <= 61 && long.endsWith("…") && !long.includes("  "), long);
	assert.equal(demoTitle(""), "Interactive demo");
});

// ─── Manim explainer builder ────────────────────────────────────────────────

const GOOD = "from manim import *\nimport numpy as np\nclass Explainer(Scene):\n    def construct(self):\n        self.play(Write(Text('hi')))  # cos(x) is fine\n";

test("sceneProblem keeps scenes to drawing code", () => {
	assert.equal(sceneProblem(GOOD), null);
	assert.match(sceneProblem(GOOD.replace("Explainer", "Intro"))!, /named Explainer/);
	assert.match(sceneProblem(`import os\n${GOOD}`)!, /"os" is not allowed/);
	assert.match(sceneProblem(`${GOOD}        open("x.txt")\n`)!, /"open"/);
	assert.match(sceneProblem(`${GOOD}        __import__("subprocess")\n`)!, /__import__/);
	assert.equal(sceneProblem(`${GOOD}        # open(this) only in a comment\n`), null);
});

function scripted(turns: Array<{ calls?: Array<[string, unknown]>; text?: string }>): PiEngine {
	const steps: FauxResponseStep[] = turns.map((t, k) =>
		t.calls
			? fauxAssistantMessage(
					t.calls.map(([name, input], j) => fauxToolCall(name, input as ToolCall["arguments"], { id: `c${k}-${j}` })),
					{ stopReason: "toolUse" },
				)
			: fauxAssistantMessage(t.text ?? ""),
	);
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

test("the builder fixes a failing render and delivers the scene that rendered", async () => {
	const broken = GOOD.replace("Write(", "Wrte(");
	const renders: string[] = [];
	const render = async (script: string): Promise<ManimRenderResult> => {
		renders.push(script);
		return script.includes("Wrte(") ? { ok: false, log: "NameError: name 'Wrte' is not defined" } : { ok: true, log: "", file: "/tmp/x.mp4", seconds: 42 };
	};
	const engine = scripted([
		{ calls: [["write_scene", { code: broken }]] },
		{ calls: [["render_scene", {}]] },
		{ calls: [["write_scene", { code: GOOD }]] },
		{ calls: [["render_scene", {}]] },
		{ text: "Shows hi." },
	]);
	const r = await runManimBuilder({ title: "T", brief: "b", latex: false }, { engine, render });
	assert.deepEqual(r, { ok: true, script: GOOD, file: "/tmp/x.mp4", seconds: 42, notes: "Shows hi." });
	assert.equal(renders.length, 2);
});

test("an unrendered or never-rendering scene is a failure with the error", async () => {
	const render = async (): Promise<ManimRenderResult> => ({ ok: false, log: "LaTeX Error: File `standalone.cls' not found." });
	const engine = scripted([{ calls: [["write_scene", { code: GOOD }]] }, { text: "Done!" }]);
	const r = await runManimBuilder({ title: "T", brief: "b", latex: true }, { engine, render });
	assert.equal(r.ok, false);
	assert.match((r as { reason: string }).reason, /never rendered cleanly[\s\S]*standalone\.cls/);
});

test("render_scene is not cut off by the 30 s server-tool guard (renders take minutes)", async () => {
	const prev = toolTimeoutMs.current;
	toolTimeoutMs.current = 50;
	try {
		let rendered = 0;
		const render = async (): Promise<ManimRenderResult> => {
			await new Promise((r) => setTimeout(r, 200));
			rendered++;
			return { ok: true, log: "", file: "/tmp/x.mp4", seconds: 40 };
		};
		const engine = scripted([{ calls: [["write_scene", { code: GOOD }]] }, { calls: [["render_scene", {}]] }, { text: "ok" }]);
		const r = await runManimBuilder({ title: "T", brief: "b", latex: false }, { engine, render });
		assert.equal(r.ok, true);
		assert.equal(rendered, 1, "the in-loop render was used, not a second gate render");
	} finally {
		toolTimeoutMs.current = prev;
	}
});
