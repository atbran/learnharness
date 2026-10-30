/**
 * Lesson demos: each demo idea in a lesson is built once by the
 * demo-builder sub-agent (written, then tested in a headless browser),
 * cached under data/curriculum/demos/<lessonId>-<i>.json, and reused from
 * then on. Only passing demos are cached; a failed build is reported on the
 * task (with the builder's own reason) and can be retried.
 *
 * Each idea can also get an optional Manim explainer animation (rendered
 * locally when manim/.venv is installed): the scene and its notes cache as
 * demos/<lessonId>-<i>-explainer.json, the video beside it as .mp4.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";

import type { Lesson } from "../core/contracts/curriculum.ts";
import { runDemoBuilder } from "../agent/subagents/demo-builder.ts";
import { getHeadless } from "../agent/subagents/headless.ts";
import { runManimBuilder } from "../agent/subagents/manim-builder.ts";
import { runTask, taskStatus, writerDeps } from "./assessments.ts";
import { programIndex } from "./curriculum.ts";
import { manimStatus, manimWorkDir, renderManimScene } from "./manim.ts";
import { stores } from "./stores.ts";

export interface LessonDemo {
	title: string;
	html: string;
	tested: true;
	notes?: string;
	createdAt: string;
}

export interface LessonExplainer {
	title: string;
	/** The Manim scene that rendered the video. */
	script: string;
	seconds: number;
	notes?: string;
	createdAt: string;
}

type BuildState = { status: "idle" | "building" | "error"; error?: string; activity?: string; startedAt?: string };

export interface DemoView {
	lessonId: string;
	index: number;
	idea: string;
	/** Short heading derived from the idea. */
	title: string;
	lesson: { title: string };
	course: { id: string; code: string; track: string };
	/** Every demo idea in the lesson, with whether it is built yet. */
	ideas: { text: string; built: boolean }[];
	demo: LessonDemo | null;
	build: BuildState;
	explainer: {
		/** Manim is installed (else `reason` says how to install it). */
		available: boolean;
		reason?: string;
		video: { url: string; seconds: number; notes?: string; createdAt: string } | null;
		build: BuildState;
	};
}

const g = globalThis as unknown as { __lhDemoActivity?: Map<string, string> };
const activity = (g.__lhDemoActivity ??= new Map());

const cacheId = (lessonId: string, i: number) => `${lessonId}-${i}`;
const taskId = (lessonId: string, i: number) => `demo:${cacheId(lessonId, i)}`;
const explainerId = (lessonId: string, i: number) => `${cacheId(lessonId, i)}-explainer`;

/** A short card title from a one-line idea: its leading noun phrase (up to
 *  the first ":", ";", dash or " with "), word-trimmed. */
export function demoTitle(idea: string): string {
	const head = idea.split(/[:;]|\s[–—-]\s|\swith\s/)[0]!.trim().replace(/[.,]$/, "");
	if (head.length <= 60) return head || "Interactive demo";
	const cut = head.slice(0, 60);
	return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

/** The house style for lesson demos (the user's reference: QNova's NMR
 *  teaching demos): one card, guided by "Try this", few controls up front,
 *  live sentences with the numbers, the formula named, check questions. */
const LESSON_DEMO_STYLE = [
	"House style (follow it exactly — the learner compares every demo against it):",
	"- One card, top to bottom: the title; a \"Try this:\" line of 1–3 concrete steps the learner can do exactly as written",
	"  (e.g. \"Set the mass to 2 kg, then double the spring constant and watch the period.\"); the controls; the drawing;",
	"  the live readout; a status line; a \"Calculated with: …\" line; then 1–3 check questions.",
	"- Controls: show only the 1–3 that matter by default (Simple). An \"Advanced\" toggle reveals the rest. Toggling",
	"  never changes a value; when an Advanced value differs from its default while Simple is shown, say",
	"  \"N advanced settings active\" with a Reset button. Every control has a label, its current value and unit, and",
	"  physically sensible defaults and ranges. A Reset button restores the defaults.",
	"- Drawing: Canvas or SVG with real axes — ticks, gridlines, axis labels with units — and labelled curves/vectors",
	"  (arrows for vectors). Let the learner drag things that are naturally draggable. Animate with requestAnimationFrame,",
	"  pause when not visible, and honour prefers-reduced-motion.",
	"- Readout: plain-language sentences with the live numbers and units, updating as controls move, e.g.",
	"  \"A 2.0 kg mass on a 50 N/m spring oscillates with period 1.26 s (0.80 swings per second).\" Use sensible",
	"  significant figures.",
	"- Status line: green for a notable success state, amber for a caution, red for a physically important",
	"  \"nothing happens\" case (e.g. \"No net force, so no acceleration\").",
	"- \"Calculated with:\" names the formula or method actually used (e.g. \"T = 2π√(m/k)\" or \"RK4 integration, Δt = 1 ms\").",
	"  Every number must come from it; never fake or hard-code results. No NaN/Infinity at the ends of any range.",
	"- Check questions: multiple choice, 1–3, about what the learner just saw. Check is disabled until a choice is",
	"  made; wrong → \"Not quite.\" in amber with a one-line explanation; right → \"Right.\" in green with the reason.",
	"- Input: pointer events so touch, Apple Pencil and mouse all work; controls at least 44 px tall on touch; fits",
	"  360–1100 px wide (stack on narrow screens).",
	"",
];

/** The builder's brief: who it's for, what the lesson teaches, what to build. */
export function demoBrief(
	ctx: { lesson: Pick<Lesson, "title" | "objectives" | "keyEquations">; course: { code: string; title: string }; unit: { title: string } },
	idea: string,
): string {
	const { lesson, course, unit } = ctx;
	return [
		"Audience: an organic chemist learning physics by self-study. Comfortable with algebra, basic calculus and chemical",
		"intuition (energy, equilibrium, spectra); new to this physics. Label every quantity by name and unit, not just its symbol.",
		"Display: give every canvas an explicit CSS width and height (e.g. width:100%; height:300px) and size its backing",
		"store from those times devicePixelRatio. The learner's screen may be HiDPI, and a canvas without a CSS size grows on each redraw.",
		"",
		...LESSON_DEMO_STYLE,
		`Lesson: ${course.code} ${course.title} · ${unit.title} · ${lesson.title}`,
		"",
		"Lesson objectives:",
		...lesson.objectives.map((o) => `- ${o}`),
		...(lesson.keyEquations.length ? ["", "Key equations (LaTeX):", ...lesson.keyEquations.map((e) => `- ${e}`)] : []),
		"",
		"The demo to build:",
		idea,
	].join("\n");
}

function lookup(lessonId: string, i: number) {
	const ref = programIndex().lessons.get(lessonId);
	if (!ref || !Number.isInteger(i) || i < 0 || i >= ref.lesson.demoIdeas.length) return null;
	return { ...ref, idea: ref.lesson.demoIdeas[i]! };
}

const readDemo = (lessonId: string, i: number) => stores.curriculumStore.readCache<LessonDemo>("demos", cacheId(lessonId, i));
const readExplainer = (lessonId: string, i: number) => stores.curriculumStore.readCache<LessonExplainer>("demos", explainerId(lessonId, i));
const videoFile = (lessonId: string, i: number) => path.join(PATHS.curriculum, "demos", `${explainerId(lessonId, i)}.mp4`);

export const lessonDemoBuilt = (lessonId: string, i: number): boolean => readDemo(lessonId, i) !== null;

/** Which demos are built, by one directory listing (no parsing): test
 *  with `builtDemos().has(demoCacheId(lessonId, i))`. */
export const builtDemos = (): Set<string> => new Set(stores.curriculumStore.listCache("demos"));
export const demoCacheId = cacheId;

/** The last build's error for this demo, if its last build failed. */
export function demoBuildError(lessonId: string, i: number): string | null {
	const t = taskStatus(taskId(lessonId, i));
	return t?.status === "error" ? (t.error ?? "the demo build failed") : null;
}

function buildState(id: string): BuildState {
	const t = taskStatus(id);
	if (t?.status === "running") return { status: "building", activity: activity.get(id), startedAt: t.startedAt };
	if (t?.status === "error") return { status: "error", error: t.error };
	return { status: "idle" };
}

/** The cached explainer MP4, or null (route: .../demos/<lessonId>/<i>/video). */
export function explainerVideoPath(lessonId: string, i: number): string | null {
	if (!lookup(lessonId, i)) return null;
	const file = videoFile(lessonId, i);
	return readExplainer(lessonId, i) && fs.existsSync(file) ? file : null;
}

export function demoView(lessonId: string, i: number): DemoView | null {
	const ref = lookup(lessonId, i);
	if (!ref) return null;
	const manim = manimStatus();
	const explainer = explainerVideoPath(lessonId, i) ? readExplainer(lessonId, i) : null;
	return {
		lessonId,
		index: i,
		idea: ref.idea,
		title: demoTitle(ref.idea),
		lesson: { title: ref.lesson.title },
		course: { id: ref.course.id, code: ref.course.code, track: ref.course.track },
		ideas: ref.lesson.demoIdeas.map((text, k) => ({ text, built: readDemo(lessonId, k) !== null })),
		demo: readDemo(lessonId, i),
		build: buildState(taskId(lessonId, i)),
		explainer: {
			available: manim.available,
			reason: manim.reason,
			video: explainer
				? {
						url: `/api/program/demos/${lessonId}/${i}/video?v=${Date.parse(explainer.createdAt)}`,
						seconds: explainer.seconds,
						notes: explainer.notes,
						createdAt: explainer.createdAt,
					}
				: null,
			build: buildState(`explainer:${explainerId(lessonId, i)}`),
		},
	};
}

/** Build the demo in the background unless it is cached (`fresh` rebuilds;
 *  the old demo stays until a new one passes). Settles when the build does;
 *  a failure is on the task (demoBuildError), not a rejection. */
export function ensureLessonDemo(lessonId: string, i: number, opts: { fresh?: boolean } = {}): Promise<void> {
	const ref = lookup(lessonId, i);
	if (!ref) throw new Error(`unknown demo ${lessonId}/${i}`);
	if (!opts.fresh && readDemo(lessonId, i)) return Promise.resolve();
	const id = taskId(lessonId, i);
	return runTask(id, `Building demo · ${ref.lesson.title}`, async () => {
		activity.set(id, "starting");
		try {
			const result = await runDemoBuilder(
				{ title: demoTitle(ref.idea), brief: demoBrief(ref, ref.idea) },
				{ engine: writerDeps("demoBuilder", false).engine, headless: getHeadless(), onActivity: (line) => activity.set(id, line) },
			);
			if (!result.html) throw new Error(result.notes?.replace(/^FAILED:\s*/, "") ?? "the demo build failed");
			stores.curriculumStore.writeCache("demos", cacheId(lessonId, i), { ...result, createdAt: new Date().toISOString() } satisfies LessonDemo);
		} finally {
			activity.delete(id);
		}
	});
}

/** Render the Manim explainer in the background unless it is cached
 *  (`fresh` re-renders; the old video stays until a new one renders). */
export function ensureLessonExplainer(lessonId: string, i: number, opts: { fresh?: boolean } = {}): void {
	const ref = lookup(lessonId, i);
	if (!ref) throw new Error(`unknown demo ${lessonId}/${i}`);
	const manim = manimStatus();
	if (!manim.available) throw new Error(manim.reason);
	if (!opts.fresh && explainerVideoPath(lessonId, i)) return;
	const id = `explainer:${explainerId(lessonId, i)}`;
	runTask(id, `Animating explainer · ${ref.lesson.title}`, async () => {
		activity.set(id, "starting");
		const work = manimWorkDir();
		try {
			const title = demoTitle(ref.idea);
			const result = await runManimBuilder(
				{ title, brief: demoBrief(ref, ref.idea), latex: manim.latex },
				{ engine: writerDeps("demoBuilder", false).engine, render: (script) => renderManimScene(work, script), onActivity: (line) => activity.set(id, line) },
			);
			if (!result.ok) throw new Error(result.reason);
			// The loop checked at 480p15; deliver 720p30, or the checked cut if that fails.
			activity.set(id, "rendering the final cut (720p)");
			const final = await renderManimScene(work, result.script, "final");
			fs.mkdirSync(path.dirname(videoFile(lessonId, i)), { recursive: true });
			fs.copyFileSync(final.ok && final.file ? final.file : result.file, videoFile(lessonId, i));
			stores.curriculumStore.writeCache("demos", explainerId(lessonId, i), {
				title,
				script: result.script,
				seconds: result.seconds,
				notes: result.notes,
				createdAt: new Date().toISOString(),
			} satisfies LessonExplainer);
		} finally {
			activity.delete(id);
			fs.rmSync(work, { recursive: true, force: true });
		}
	});
}
