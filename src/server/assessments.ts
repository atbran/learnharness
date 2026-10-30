/**
 * Assessments: quick checks, unit problem sets, exams, placement tests.
 * Each artifact is generated once in the background, cached under
 * data/curriculum/{quizzes,assessments}/, and graded server-side (never
 * trusting a client score). Results land in the progress ledger.
 */

import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { gradeDeterministic, placementTestOuts, totalScore } from "../core/assessments.ts";
import type { Assessment, AssessmentKind, CheckResult, Lesson, QuickCheck } from "../core/contracts/curriculum.ts";
import { emit } from "../core/events.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import type { ModelRole } from "../../config.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { processImage } from "../agent/image-processing/index.ts";
import { bookTools } from "../agent/tools/books.ts";
import { gradeAssessment, gradeShortAnswers, writeAssessment, writeQuickCheck, type WriterDeps } from "../agent/subagents/program-writers.ts";
import { bookToolContext } from "./bookshelf.ts";
import { programIndex, recordProgress, resolveReadings } from "./curriculum.ts";
import { stores } from "./stores.ts";

// ─── Background task registry (process-global) ──────────────────────────────

export interface ProgramTask {
	id: string;
	label: string;
	status: "running" | "done" | "error";
	error?: string;
	startedAt: string;
}

const g = globalThis as unknown as { __lhProgramTasks?: Map<string, ProgramTask>; __lhProgramTaskRuns?: Map<string, Promise<void>> };
const tasks = (g.__lhProgramTasks ??= new Map());
const runs = (g.__lhProgramTaskRuns ??= new Map());

export function programTasks(): ProgramTask[] {
	return [...tasks.values()].filter((t) => t.status === "running" || Date.now() - Date.parse(t.startedAt) < 10 * 60_000);
}

export function taskStatus(id: string): ProgramTask | null {
	return tasks.get(id) ?? null;
}

/** Run `fn` once per id (a second call while running joins the first).
 *  The promise settles when the task does and never rejects: the outcome
 *  is on the task (taskStatus). */
export function runTask(id: string, label: string, fn: () => Promise<void>): Promise<void> {
	if (tasks.get(id)?.status === "running") return runs.get(id) ?? Promise.resolve();
	const t: ProgramTask = { id, label, status: "running", startedAt: new Date().toISOString() };
	tasks.set(id, t);
	emit("curriculum-changed", {});
	const run = fn()
		.then(() => {
			t.status = "done";
		})
		.catch((err: unknown) => {
			t.status = "error";
			t.error = err instanceof Error ? err.message : String(err);
		})
		.finally(() => {
			runs.delete(id);
			emit("curriculum-changed", {});
		});
	runs.set(id, run);
	return run;
}

export function writerDeps(role: ModelRole, withBooks: boolean): WriterDeps {
	const spec = resolveRoleSpec(role, stores.settingsStore.readSettings());
	if (!spec) throw new Error(`No model is configured for ${role} — set the model slots in Settings.`);
	const books = withBooks && stores.bookshelfStore.listBooks().length > 0 ? bookTools(bookToolContext()) : undefined;
	return { engine: piEngineForSpec(spec), bookTools: books };
}

export function lessonContext(lesson: Lesson): string {
	const ref = programIndex().lessons.get(lesson.id)!;
	const readings = resolveReadings(lesson)
		.map((r) => `${r.label}${r.pages ? ` (pp. ${r.pages})` : ""}`)
		.join("; ");
	return `Course ${ref.course.code} ${ref.course.title} · Unit: ${ref.unit.title} — ${ref.unit.summary}${readings ? `\nAssigned reading: ${readings}` : ""}`;
}

// ─── Quick checks ───────────────────────────────────────────────────────────

/** Public view: answers/rubrics stripped. */
export type PublicCheckQuestion = (
	| { kind: "mc"; prompt: string; options: string[] }
	| { kind: "numeric"; prompt: string; unit?: string }
	| { kind: "short"; prompt: string }
) & { equations?: string[] };

/** The lesson's quick check: authored (shipped with the curriculum) first,
 *  else a generated one from the cache. */
function readQuickCheck(lessonId: string): QuickCheck | null {
	const authored = stores.curriculumStore.authoredCheck(lessonId);
	if (authored) return { lessonId, createdAt: "authored", questions: authored };
	return stores.curriculumStore.readCache<QuickCheck>("quizzes", lessonId);
}

export function quickCheckView(
	lessonId: string,
): { status: "ready"; questions: PublicCheckQuestion[]; sheet: string[] } | { status: "generating" | "missing" | "error"; error?: string } {
	const cached = readQuickCheck(lessonId);
	if (cached)
		return {
			status: "ready",
			/** The lesson's key equations: the quiz's equation sheet. */
			sheet: programIndex().lessons.get(lessonId)?.lesson.keyEquations ?? [],
			questions: cached.questions.map((q): PublicCheckQuestion => {
				const equations = q.equations?.length ? { equations: q.equations } : {};
				if (q.kind === "mc") return { kind: "mc", prompt: q.prompt, options: q.options, ...equations };
				if (q.kind === "numeric") return { kind: "numeric", prompt: q.prompt, unit: q.unit, ...equations };
				return { kind: "short", prompt: q.prompt, ...equations };
			}),
		};
	const t = taskStatus(`check:${lessonId}`);
	if (t?.status === "running") return { status: "generating" };
	if (t?.status === "error") return { status: "error", error: t.error };
	return { status: "missing" };
}

export function ensureQuickCheck(lessonId: string): void {
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) throw new Error(`unknown lesson ${lessonId}`);
	if (readQuickCheck(lessonId)) return;
	runTask(`check:${lessonId}`, `Writing quick check · ${ref.lesson.title}`, async () => {
		const questions = await writeQuickCheck(ref.lesson, lessonContext(ref.lesson), ref.course.track, writerDeps("checkWriter", false));
		stores.curriculumStore.writeCache("quizzes", lessonId, { lessonId, createdAt: new Date().toISOString(), questions } satisfies QuickCheck);
	});
}

/** Grade a submitted quick check; records the score in the ledger. With
 *  `review`, it is a spaced-review attempt (review_done) instead. */
export async function submitQuickCheck(lessonId: string, responses: string[], opts: { review?: boolean; only?: number[] } = {}): Promise<CheckResult> {
	const check = readQuickCheck(lessonId);
	if (!check) throw new Error("no quick check for this lesson yet");
	const indexes = opts.only ?? check.questions.map((_, i) => i);
	const perQuestion: CheckResult["perQuestion"] = [];
	const shortItems: { at: number; prompt: string; rubric: string; modelAnswer: string; response: string }[] = [];
	indexes.forEach((qi, k) => {
		const q = check.questions[qi]!;
		const response = responses[k] ?? "";
		const det = gradeDeterministic(q, response);
		if (det) perQuestion.push({ correct: det.correct, credit: det.correct ? 1 : 0, feedback: det.feedback });
		else if (q.kind === "short") {
			perQuestion.push({ correct: false, credit: 0, feedback: "" });
			shortItems.push({ at: k, prompt: q.prompt, rubric: q.rubric, modelAnswer: q.modelAnswer, response });
		}
	});
	if (shortItems.length) {
		const blank = shortItems.every((s) => !s.response.trim());
		const graded = blank ? shortItems.map(() => ({ credit: 0, feedback: "No answer given." })) : await gradeShortAnswers(shortItems, writerDeps("checkWriter", false));
		shortItems.forEach((s, i) => {
			const gr = graded[i]!;
			const q = check.questions[indexes[s.at]!]! as Extract<QuickCheck["questions"][number], { kind: "short" }>;
			perQuestion[s.at] = { correct: gr.credit >= 0.7, credit: gr.credit, feedback: `${gr.feedback} Model answer: ${q.modelAnswer}` };
		});
	}
	const score = perQuestion.reduce((s, q) => s + q.credit, 0) / Math.max(1, perQuestion.length);
	const at = new Date().toISOString();
	if (opts.review) recordProgress({ type: "review_done", at, lessonId, quality: Math.round(score * 5) });
	else recordProgress({ type: "quick_check", at, lessonId, score });
	return { lessonId, at, score, perQuestion };
}

// ─── Problem sets / exams / placement ───────────────────────────────────────

const PROBLEMS: Record<AssessmentKind, number> = { pset: 6, midterm: 7, final: 9, placement: 0 };

export function listAssessments(): Assessment[] {
	return stores.curriculumStore
		.listCache("assessments")
		.map((id) => stores.curriculumStore.readCache<Assessment>("assessments", id))
		.filter((a): a is Assessment => a !== null)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getAssessment(id: string): Assessment | null {
	return /^[a-z0-9-]+$/.test(id) ? stores.curriculumStore.readCache<Assessment>("assessments", id) : null;
}

function save(a: Assessment): void {
	stores.curriculumStore.writeCache("assessments", a.id, a);
}

/** Open (or reuse an unfinished) assessment for a unit problem set or a
 *  course exam. `fresh` forces a new variant. */
export function openAssessment(target: { unitId?: string; examId?: string }, fresh = false): Assessment {
	const index = programIndex();
	let a: Assessment;
	if (target.unitId) {
		const u = index.units.get(target.unitId);
		if (!u) throw new Error("unknown unit");
		a = {
			id: `pset-${target.unitId}-${randomUUID().slice(0, 8)}`,
			kind: "pset",
			courseId: u.course.id,
			unitIds: [u.unit.id],
			title: `Problem set · ${u.unit.title}`,
			minutes: null,
			closedBook: false,
			passMark: 0.7,
			status: "generating",
			createdAt: new Date().toISOString(),
			problems: [],
			answers: {},
		};
	} else if (target.examId) {
		const e = index.exams.get(target.examId);
		if (!e) throw new Error("unknown exam");
		a = {
			id: `${e.exam.kind}-${e.exam.id}-${randomUUID().slice(0, 8)}`,
			kind: e.exam.kind,
			courseId: e.course.id,
			unitIds: e.exam.covers,
			examId: e.exam.id,
			title: e.exam.title,
			minutes: e.exam.minutes,
			closedBook: e.exam.kind !== "placement" ? true : false,
			passMark: e.exam.passMark,
			status: "generating",
			createdAt: new Date().toISOString(),
			problems: [],
			answers: {},
		};
	} else throw new Error("unitId or examId required");

	if (!fresh) {
		const open = listAssessments().find(
			(x) => x.status !== "graded" && x.status !== "error" && x.kind === a.kind && x.examId === a.examId && x.unitIds.join() === a.unitIds.join(),
		);
		if (open) return open;
	}
	save(a);
	generate(a.id);
	return a;
}

function generate(id: string): void {
	runTask(`assess:${id}`, "Writing assessment", async () => {
		const a = getAssessment(id)!;
		const index = programIndex();
		const course = index.courses.get(a.courseId)!;
		const units = a.unitIds.map((u) => index.units.get(u)!.unit);
		try {
			const problems = await writeAssessment(
				{
					kind: a.kind,
					courseTitle: `${course.code} ${course.title}`,
					track: course.track,
					minutes: a.minutes,
					units: units.map((u) => ({ id: u.id, title: u.title, summary: u.summary, lessons: u.lessons })),
					problemCount: a.kind === "placement" ? Math.min(14, units.length * 2) : PROBLEMS[a.kind],
				},
				writerDeps("examWriter", true),
			);
			save({ ...getAssessment(id)!, status: "ready", problems: problems.map((p, i) => ({ ...p, id: `p${i + 1}` })) });
		} catch (err) {
			save({ ...getAssessment(id)!, status: "error", error: err instanceof Error ? err.message : String(err) });
			throw err;
		}
	});
}

export function retryAssessment(id: string): void {
	const a = getAssessment(id);
	if (!a || a.status !== "error") return;
	save({ ...a, status: "generating", error: undefined });
	generate(id);
}

export function startAssessment(id: string): Assessment {
	const a = getAssessment(id);
	if (!a) throw new Error("unknown assessment");
	if (a.status === "ready") {
		a.status = "in-progress";
		a.startedAt = new Date().toISOString();
		save(a);
	}
	return a;
}

export function saveAnswer(id: string, problemId: string, text: string): void {
	const a = getAssessment(id);
	if (!a || a.status !== "in-progress") throw new Error("assessment is not in progress");
	if (!a.problems.some((p) => p.id === problemId)) throw new Error("unknown problem");
	const prev = a.answers[problemId] ?? { text: "", images: [] };
	a.answers[problemId] = { ...prev, text: text.slice(0, 20_000) };
	save(a);
}

export async function addUpload(id: string, problemId: string, bytes: Uint8Array, mimeType: string): Promise<string> {
	const a = getAssessment(id);
	if (!a || a.status !== "in-progress") throw new Error("assessment is not in progress");
	if (!a.problems.some((p) => p.id === problemId)) throw new Error("unknown problem");
	const processed = await processImage(bytes, mimeType, { resizeOptions: { maxWidth: 1800, maxHeight: 2400 } });
	if (!processed.ok) throw new Error(processed.message);
	const ext = processed.mimeType === "image/png" ? "png" : processed.mimeType === "image/webp" ? "webp" : "jpg";
	const file = `${id}-${problemId}-${randomUUID().slice(0, 6)}.${ext}`;
	fs.writeFileSync(stores.curriculumStore.artifactPath("uploads", file), Buffer.from(processed.data, "base64"));
	const fresh = getAssessment(id)!;
	const prev = fresh.answers[problemId] ?? { text: "", images: [] };
	fresh.answers[problemId] = { ...prev, images: [...prev.images, file] };
	save(fresh);
	return file;
}

export function removeUpload(id: string, problemId: string, file: string): void {
	const a = getAssessment(id);
	if (!a || a.status !== "in-progress") throw new Error("assessment is not in progress");
	const prev = a.answers[problemId];
	if (!prev) return;
	a.answers[problemId] = { ...prev, images: prev.images.filter((f) => f !== file) };
	save(a);
}

export function uploadPath(file: string): string | null {
	if (!/^[a-z0-9-]+-p\d+-[0-9a-f]{6}\.(jpg|png|webp)$/.test(file)) return null;
	const p = stores.curriculumStore.artifactPath("uploads", file);
	return fs.existsSync(p) ? p : null;
}

export function submitAssessment(id: string): Assessment {
	const a = getAssessment(id);
	if (!a) throw new Error("unknown assessment");
	if (a.status !== "in-progress" && a.status !== "grading") throw new Error("assessment is not in progress");
	a.status = "grading";
	a.submittedAt ??= new Date().toISOString();
	save(a);
	grade(id);
	return a;
}

function grade(id: string): void {
	runTask(`grade:${id}`, "Grading your work", async () => {
		const a = getAssessment(id)!;
		const images: { data: string; mimeType: string }[] = [];
		const answers: Record<string, { text: string; imageIndexes: number[] }> = {};
		for (const p of a.problems) {
			const ans = a.answers[p.id] ?? { text: "", images: [] };
			const idx: number[] = [];
			for (const f of ans.images) {
				const path = uploadPath(f);
				if (!path) continue;
				idx.push(images.length);
				images.push({ data: fs.readFileSync(path).toString("base64"), mimeType: f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : "image/jpeg" });
			}
			answers[p.id] = { text: ans.text, imageIndexes: idx };
		}
		try {
			const { grades, summary } = await gradeAssessment({ problems: a.problems, answers, images }, writerDeps("grader", false));
			const score = totalScore(grades);
			const index = programIndex();
			const testedOut =
				a.kind === "placement" ? placementTestOuts(a, grades, (u) => index.units.get(u)?.unit.lessons.map((l) => l.id) ?? []) : undefined;
			const gradedAt = new Date().toISOString();
			save({ ...getAssessment(id)!, status: "graded", grade: { score, perProblem: grades, summary, testedOut, gradedAt } });
			recordProgress({ type: "assessment_graded", at: gradedAt, assessmentId: a.id, kind: a.kind, courseId: a.courseId, unitIds: a.unitIds, score });
			if (testedOut?.length) recordProgress({ type: "placement", at: gradedAt, lessonIds: testedOut });
		} catch (err) {
			// Back to in-progress so the learner can resubmit (nothing lost).
			save({ ...getAssessment(id)!, status: "in-progress", error: err instanceof Error ? err.message : String(err) });
			throw err;
		}
	});
}

/** The learner's view: hides rubrics/solutions until graded. */
/** The formula sheet for an assessment: each covered lesson's key equations. */
function equationSheet(a: Assessment): { title: string; equations: string[] }[] {
	const units = new Set(a.unitIds);
	const index = programIndex();
	return index.lessonOrder
		.map((id) => index.lessons.get(id)!)
		.filter((ref) => units.has(ref.unit.id) && ref.lesson.keyEquations.length > 0)
		.map((ref) => ({ title: ref.lesson.title, equations: ref.lesson.keyEquations }));
}

export function assessmentView(a: Assessment) {
	const graded = a.status === "graded";
	return {
		...a,
		sheet: equationSheet(a),
		problems: a.problems.map((p) => (graded ? p : { ...p, rubric: [], solution: "" })),
		task: taskStatus(`assess:${a.id}`) ?? taskStatus(`grade:${a.id}`),
	};
}
