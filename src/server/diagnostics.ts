/**
 * Unit test-out diagnostics: two fresh auto-graded questions per lesson,
 * written once per unit (cached as data/curriculum/diagnostics/<unitId>.json)
 * and graded instantly. Per lesson: 2/2 tests it out (placement), 1/2 sends
 * it to the fast track with what was missed (diagnostic), 0/2 leaves the
 * full lesson.
 */

import { gradeDeterministic } from "../core/assessments.ts";
import { writeUnitDiagnostic, type DiagnosticQuestion } from "../agent/subagents/program-writers.ts";
import { runTask, taskStatus, writerDeps } from "./assessments.ts";
import { programIndex, recordProgress } from "./curriculum.ts";
import { stores } from "./stores.ts";

export interface UnitDiagnostic {
	unitId: string;
	createdAt: string;
	questions: DiagnosticQuestion[];
}

export type PublicDiagnosticQuestion = { lessonId: string; equations?: string[] } & (
	| { kind: "mc"; prompt: string; options: string[] }
	| { kind: "numeric"; prompt: string; unit?: string }
);

export type DiagnosticView =
	| { status: "ready"; questions: PublicDiagnosticQuestion[] }
	| { status: "generating" | "missing" }
	| { status: "error"; error: string };

export interface DiagnosticLessonResult {
	lessonId: string;
	correct: number;
	outcome: "tested-out" | "fast-track" | "full";
}

export interface DiagnosticResult {
	unitId: string;
	lessons: DiagnosticLessonResult[];
	perQuestion: { correct: boolean; feedback: string }[];
}

const taskId = (unitId: string) => `diagnostic:${unitId}`;
const readDiagnostic = (unitId: string) => stores.curriculumStore.readCache<UnitDiagnostic>("diagnostics", unitId);

export function diagnosticView(unitId: string): DiagnosticView | null {
	if (!programIndex().units.has(unitId)) return null;
	const d = readDiagnostic(unitId);
	if (d)
		return {
			status: "ready",
			questions: d.questions.map((q): PublicDiagnosticQuestion => {
				const base = { lessonId: q.lessonId, ...(q.equations?.length ? { equations: q.equations } : {}) };
				return q.kind === "mc" ? { ...base, kind: "mc", prompt: q.prompt, options: q.options } : { ...base, kind: "numeric", prompt: q.prompt, unit: q.unit };
			}),
		};
	const t = taskStatus(taskId(unitId));
	if (t?.status === "running") return { status: "generating" };
	if (t?.status === "error") return { status: "error", error: t.error ?? "the diagnostic could not be written" };
	return { status: "missing" };
}

/** Write the unit's diagnostic in the background unless cached. */
export function ensureDiagnostic(unitId: string): void {
	const ref = programIndex().units.get(unitId);
	if (!ref) throw new Error(`unknown unit ${unitId}`);
	if (readDiagnostic(unitId)) return;
	void runTask(taskId(unitId), `Writing test-out diagnostic · ${ref.unit.title}`, async () => {
		const lessons = ref.unit.lessons.map((lesson) => ({
			lesson,
			avoid: (stores.curriculumStore.authoredCheck(lesson.id) ?? []).map((q) => q.prompt),
		}));
		const questions = await writeUnitDiagnostic(
			ref.unit,
			lessons,
			`Course ${ref.course.code} ${ref.course.title}`,
			ref.course.track,
			writerDeps("checkWriter", false),
		);
		// Keep each lesson's pair together, in unit order.
		const order = ref.unit.lessons.map((l) => l.id);
		questions.sort((a, b) => order.indexOf(a.lessonId) - order.indexOf(b.lessonId));
		stores.curriculumStore.writeCache("diagnostics", unitId, { unitId, createdAt: new Date().toISOString(), questions } satisfies UnitDiagnostic);
	});
}

/** Grade a submitted diagnostic (responses in question order) and record
 *  the per-lesson outcomes in the ledger. */
export function submitDiagnostic(unitId: string, responses: string[]): DiagnosticResult {
	const d = readDiagnostic(unitId);
	if (!d) throw new Error("no diagnostic for this unit yet");
	const perQuestion = d.questions.map((q, i) => {
		const g = gradeDeterministic(q, responses[i] ?? "");
		return { correct: g?.correct ?? false, feedback: g?.feedback ?? "" };
	});
	const unit = programIndex().units.get(unitId)!.unit;
	const lessons = unit.lessons.map((l): DiagnosticLessonResult => {
		const mine = d.questions.map((q, i) => ({ q, i })).filter((x) => x.q.lessonId === l.id);
		const correct = mine.filter((x) => perQuestion[x.i]!.correct).length;
		const outcome = mine.length > 0 && correct === mine.length ? "tested-out" : correct > 0 ? "fast-track" : "full";
		return { lessonId: l.id, correct, outcome };
	});
	const at = new Date().toISOString();
	const testedOut = lessons.filter((l) => l.outcome === "tested-out").map((l) => l.lessonId);
	if (testedOut.length) recordProgress({ type: "placement", at, lessonIds: testedOut });
	for (const l of lessons.filter((x) => x.outcome !== "tested-out")) {
		const missed = d.questions
			.map((q, i) => ({ q, i }))
			.filter((x) => x.q.lessonId === l.lessonId && !perQuestion[x.i]!.correct)
			.map((x) => ({ prompt: x.q.prompt, explanation: x.q.explanation }));
		// A full miss still marks the unit diagnosed; only 1/2 goes fast-track.
		recordProgress({ type: "diagnostic", at, unitId, lessonId: l.lessonId, missed: l.outcome === "fast-track" ? missed : [] });
	}
	return { unitId, lessons, perQuestion };
}
