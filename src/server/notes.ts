/**
 * Lesson notes: written text that teaches a lesson on its own, beside the
 * lecture — written once by the notes writer (grounded in the assigned book
 * pages) and cached as data/curriculum/notes/<lessonId>.json. A background
 * builder writes them ahead of the learner (data/curriculum/notes-prebuild.json).
 */

import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { writeLessonNotes } from "../agent/subagents/program-writers.ts";
import { lessonContext, runTask, taskStatus, writerDeps } from "./assessments.ts";
import { programIndex } from "./curriculum.ts";
import { createPrebuild, type PrebuildStatus } from "./prebuild.ts";
import { stores } from "./stores.ts";

export interface LessonNotes {
	markdown: string;
	createdAt: string;
}

const taskId = (lessonId: string) => `notes:${lessonId}`;
const readNotes = (lessonId: string) => stores.curriculumStore.readCache<LessonNotes>("notes", lessonId);

export type NotesView =
	| { status: "ready"; notes: LessonNotes }
	| { status: "writing" | "missing" }
	| { status: "error"; error: string };

export function notesView(lessonId: string): NotesView | null {
	if (!programIndex().lessons.has(lessonId)) return null;
	const notes = readNotes(lessonId);
	if (notes) return { status: "ready", notes };
	const t = taskStatus(taskId(lessonId));
	if (t?.status === "running") return { status: "writing" };
	if (t?.status === "error") return { status: "error", error: t.error ?? "the notes could not be written" };
	return { status: "missing" };
}

/** Write the notes in the background unless cached (`fresh` rewrites; the
 *  old notes stay until new ones are written). Settles when done. */
export function ensureLessonNotes(lessonId: string, opts: { fresh?: boolean } = {}): Promise<void> {
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) throw new Error(`unknown lesson ${lessonId}`);
	if (!opts.fresh && readNotes(lessonId)) return Promise.resolve();
	return runTask(taskId(lessonId), `Writing notes · ${ref.lesson.title}`, async () => {
		const markdown = await writeLessonNotes(ref.lesson, lessonContext(ref.lesson), ref.course.track, writerDeps("notesWriter", true));
		stores.curriculumStore.writeCache("notes", lessonId, { markdown, createdAt: new Date().toISOString() } satisfies LessonNotes);
	});
}

const notes = createPrebuild({
	name: "notes",
	stateFile: path.join(PATHS.curriculum, "notes-prebuild.json"),
	concurrency: 2,
	count: () => 1,
	built: () => new Set(stores.curriculumStore.listCache("notes")),
	cacheId: (lessonId) => lessonId,
	build: (lessonId) => ensureLessonNotes(lessonId),
	error: (lessonId) => {
		const t = taskStatus(taskId(lessonId));
		return t?.status === "error" ? (t.error ?? "the notes could not be written") : null;
	},
	label: (lesson) => lesson.title,
});

export type NotesPrebuildStatus = PrebuildStatus;
export const resumeNotesPrebuild = notes.resume;
export const setNotesPrebuild = notes.set;
export const notesPrebuildStatus = notes.status;
