/**
 * The learner's own material: the question board (questions they want
 * physics to answer, each matched to the lesson that answers it) and the
 * notebook (their teach-back explanations with brief feedback). Stored as
 * data/curriculum/learner/{questions,notebook}.json.
 */

import { randomUUID } from "node:crypto";
import { matchQuestion, reviewExplanation } from "../agent/subagents/program-writers.ts";
import { runTask, writerDeps } from "./assessments.ts";
import { programIndex } from "./curriculum.ts";
import { stores } from "./stores.ts";

export interface BoardQuestion {
	id: string;
	text: string;
	createdAt: string;
	status: "matching" | "matched" | "unmatched" | "error";
	unitId: string | null;
	lessonId: string | null;
	/** How the lesson answers it (or, unmatched, what kind of lesson would). */
	note: string;
}

export interface NotebookEntry {
	id: string;
	lessonId: string;
	text: string;
	at: string;
	feedback: string | null;
	accurate: boolean | null;
}

const readQuestions = () => stores.curriculumStore.readCache<BoardQuestion[]>("learner", "questions") ?? [];
const writeQuestions = (qs: BoardQuestion[]) => stores.curriculumStore.writeCache("learner", "questions", qs);
const readNotebook = () => stores.curriculumStore.readCache<NotebookEntry[]>("learner", "notebook") ?? [];
const writeNotebook = (es: NotebookEntry[]) => stores.curriculumStore.writeCache("learner", "notebook", es);

function updateQuestion(id: string, patch: Partial<BoardQuestion>): void {
	writeQuestions(readQuestions().map((q) => (q.id === id ? { ...q, ...patch } : q)));
}

export function listQuestions(): BoardQuestion[] {
	return readQuestions();
}

/** Add a question and match it to a lesson in the background. */
export function addQuestion(text: string): BoardQuestion {
	const clean = text.trim().slice(0, 500);
	if (!clean) throw new Error("the question is empty");
	const q: BoardQuestion = { id: randomUUID().slice(0, 8), text: clean, createdAt: new Date().toISOString(), status: "matching", unitId: null, lessonId: null, note: "" };
	writeQuestions([q, ...readQuestions()]);
	void runTask(`question:${q.id}`, "Matching your question to a lesson", async () => {
		try {
			const index = programIndex();
			const units = [...index.units.values()].map(({ unit, course }) => ({
				id: unit.id,
				course: course.code,
				title: unit.title,
				summary: unit.summary,
				lessons: unit.lessons.map((l) => ({ id: l.id, title: l.title, objectives: l.objectives })),
			}));
			const m = await matchQuestion(clean, units, writerDeps("checkWriter", false));
			updateQuestion(q.id, { status: m.lessonId ? "matched" : "unmatched", unitId: m.unitId, lessonId: m.lessonId, note: m.note });
		} catch (err) {
			updateQuestion(q.id, { status: "error", note: err instanceof Error ? err.message : String(err) });
			throw err;
		}
	});
	return q;
}

export function removeQuestion(id: string): void {
	writeQuestions(readQuestions().filter((q) => q.id !== id));
}

export function listNotebook(): NotebookEntry[] {
	return readNotebook();
}

/** Save a teach-back explanation, then get brief feedback on it. */
export async function addExplanation(lessonId: string, text: string): Promise<NotebookEntry> {
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) throw new Error("unknown lesson");
	const clean = text.trim().slice(0, 8000);
	if (!clean) throw new Error("the explanation is empty");
	const entry: NotebookEntry = { id: randomUUID().slice(0, 8), lessonId, text: clean, at: new Date().toISOString(), feedback: null, accurate: null };
	writeNotebook([entry, ...readNotebook()]);
	try {
		const r = await reviewExplanation(ref.lesson, clean, writerDeps("checkWriter", false));
		const done = { ...entry, feedback: r.feedback, accurate: r.accurate };
		writeNotebook(readNotebook().map((e) => (e.id === entry.id ? done : e)));
		return done;
	} catch {
		// The explanation is kept even when feedback couldn't be written.
		return entry;
	}
}

export function removeExplanation(id: string): void {
	writeNotebook(readNotebook().filter((e) => e.id !== id));
}
