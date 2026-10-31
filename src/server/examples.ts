/**
 * Worked examples: 1–10 problems per lesson solved step by step, at least one
 * per objective — written once by the notes writer (grounded in the assigned
 * book pages) and cached as data/curriculum/examples/<lessonId>.json. A
 * background builder writes them ahead of the learner
 * (data/curriculum/examples-prebuild.json).
 */

import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { writeWorkedExamples, type WorkedExample } from "../agent/subagents/program-writers.ts";
import { lessonContext, runTask, taskStatus, writerDeps } from "./assessments.ts";
import { latestExampleAttempts, type AttemptResult, type ExampleAttempt } from "../core/example-attempts.ts";
import { programIndex, recordProgress } from "./curriculum.ts";
import { createPrebuild, type PrebuildStatus } from "./prebuild.ts";
import { stores } from "./stores.ts";

export type { WorkedExample };

export interface LessonExamples {
	examples: WorkedExample[];
	createdAt: string;
}

const taskId = (lessonId: string) => `examples:${lessonId}`;
const readExamples = (lessonId: string) => stores.curriculumStore.readCache<LessonExamples>("examples", lessonId);

export type ExamplesView =
	| { status: "ready"; examples: LessonExamples; attempts: Record<number, ExampleAttempt> }
	| { status: "writing" | "missing" }
	| { status: "error"; error: string };

export function examplesView(lessonId: string): ExamplesView | null {
	if (!programIndex().lessons.has(lessonId)) return null;
	const examples = readExamples(lessonId);
	if (examples) return { status: "ready", examples, attempts: latestExampleAttempts(stores.curriculumStore.readEvents(), lessonId) };
	const t = taskStatus(taskId(lessonId));
	if (t?.status === "running") return { status: "writing" };
	if (t?.status === "error") return { status: "error", error: t.error ?? "the worked examples could not be written" };
	return { status: "missing" };
}

/** Write the examples in the background unless cached (`fresh` rewrites; the
 *  old ones stay until new ones are written). Settles when done. */
export function ensureWorkedExamples(lessonId: string, opts: { fresh?: boolean } = {}): Promise<void> {
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) throw new Error(`unknown lesson ${lessonId}`);
	if (!opts.fresh && readExamples(lessonId)) return Promise.resolve();
	return runTask(taskId(lessonId), `Writing worked examples · ${ref.lesson.title}`, async () => {
		const examples = await writeWorkedExamples(ref.lesson, lessonContext(ref.lesson), ref.course.track, writerDeps("notesWriter", true));
		stores.curriculumStore.writeCache("examples", lessonId, { examples, createdAt: new Date().toISOString() } satisfies LessonExamples);
	});
}

/** Save the learner's report on trying one example (the whole report; the latest wins). */
export function recordExampleAttempt(lessonId: string, attempt: { example: number; confidence?: number; result?: AttemptResult; stuck?: string }): void {
	const count = readExamples(lessonId)?.examples.length ?? 0;
	if (attempt.example >= count) throw new Error("no such worked example");
	recordProgress({ type: "example_attempt", at: new Date().toISOString(), lessonId, ...attempt, stuck: attempt.stuck?.trim() || undefined });
}

const examples = createPrebuild({
	name: "examples",
	stateFile: path.join(PATHS.curriculum, "examples-prebuild.json"),
	concurrency: 2,
	count: () => 1,
	built: () => new Set(stores.curriculumStore.listCache("examples")),
	cacheId: (lessonId) => lessonId,
	build: (lessonId) => ensureWorkedExamples(lessonId),
	error: (lessonId) => {
		const t = taskStatus(taskId(lessonId));
		return t?.status === "error" ? (t.error ?? "the worked examples could not be written") : null;
	},
	label: (lesson) => lesson.title,
});

export type ExamplesPrebuildStatus = PrebuildStatus;
export const resumeExamplesPrebuild = examples.resume;
export const setExamplesPrebuild = examples.set;
export const examplesPrebuildStatus = examples.status;
