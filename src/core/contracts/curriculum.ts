/**
 * Curriculum domain — the static program spine (curriculum/<program>/*.json)
 * and the learner's progress ledger (data/curriculum/progress.jsonl).
 *
 * The spine is CONTENT: authored once, validated by these schemas
 * (scripts/validate-curriculum.ts), shipped read-only in the repo. Progress
 * is EVIDENCE: append-only events; every state (lesson status, mastery,
 * pace, XP, streak, review queue) is derived on read in core/progress.ts —
 * the repo's law: writes point to evidence, everything else is derived.
 */

import { z } from "zod";

const ID = /^[a-z0-9][a-z0-9-]*$/;
const id = () => z.string().regex(ID, "ids are lowercase kebab-case");

// ─── Books catalog (curriculum/books.json) ──────────────────────────────────

export const bookSchema = z.object({
	id: id(),
	title: z.string().min(1),
	authors: z.array(z.string()).min(1),
	edition: z.string().optional(),
	isbn: z.string().optional(),
	/** A legal free download, when one exists (OpenStax, lecture notes). */
	freeUrl: z.string().url().optional(),
	/** Lowercase words the ingest matcher uses to recognise the PDF. */
	matchHints: z.array(z.string()).default([]),
});
export type Book = z.infer<typeof bookSchema>;

export const booksCatalogSchema = z.object({ books: z.array(bookSchema) });
export type BooksCatalog = z.infer<typeof booksCatalogSchema>;

// ─── Spine ──────────────────────────────────────────────────────────────────

export const readingSchema = z.object({
	bookId: id(),
	/** Section reference as printed in the book: "§2.3", "Ch. 4", "4.2-4.4". */
	ref: z.string().min(1),
	/** The section's printed title — the outline matcher's second key. */
	title: z.string().min(1),
	optional: z.boolean().optional(),
});
export type Reading = z.infer<typeof readingSchema>;

export const lectureSchema = z.object({
	/** e.g. "MIT OCW 8.04 (2013)", "3Blue1Brown". */
	source: z.string().min(1),
	title: z.string().min(1),
	url: z.string().url(),
	/** Seconds into the video. */
	start: z.number().int().nonnegative().optional(),
	end: z.number().int().positive().optional(),
});
export type Lecture = z.infer<typeof lectureSchema>;

export const lessonSchema = z.object({
	id: id(),
	title: z.string().min(1),
	minutes: z.number().int().min(15).max(180),
	/** Lesson ids (any course) that must be mastered first. The previous
	 *  lesson in the unit is an implicit prerequisite and is not listed. */
	prereqs: z.array(id()).default([]),
	objectives: z.array(z.string().min(1)).min(2).max(8),
	/** LaTeX, no delimiters. */
	keyEquations: z.array(z.string()).default([]),
	readings: z.array(readingSchema).default([]),
	lectures: z.array(lectureSchema).default([]),
	/** One-line briefs for the demo builder. */
	demoIdeas: z.array(z.string()).default([]),
	/** Textbook exercise pointers, e.g. "Griffiths EM 2.15". */
	practice: z.array(z.string()).default([]),
	/** Subject axis for the mastery radar (overrides the course's). */
	subject: z.string().optional(),
});
export type Lesson = z.infer<typeof lessonSchema>;

export const unitSchema = z.object({
	id: id(),
	title: z.string().min(1),
	summary: z.string().min(1),
	lessons: z.array(lessonSchema).min(1),
	/** "Grad touch" units go beyond the undergrad core. */
	grad: z.boolean().optional(),
});
export type Unit = z.infer<typeof unitSchema>;

export const examSchema = z.object({
	id: id(),
	kind: z.enum(["midterm", "final", "placement"]),
	title: z.string().min(1),
	/** Unit ids the exam covers. */
	covers: z.array(id()).min(1),
	minutes: z.number().int().min(10).max(240),
	/** Fraction 0..1 needed to pass (placement: to test out). */
	passMark: z.number().min(0).max(1),
});
export type Exam = z.infer<typeof examSchema>;

export const TRACKS = ["math", "physics", "survey", "capstone"] as const;
export type Track = (typeof TRACKS)[number];

export const courseSchema = z.object({
	id: id(),
	code: z.string().min(1),
	title: z.string().min(1),
	track: z.enum(TRACKS),
	depth: z.enum(["core", "survey", "capstone"]),
	hours: z.number().positive(),
	/** Course ids that must be passed (or substantially done) first. */
	prereqs: z.array(id()).default([]),
	/** Radar axis, e.g. "Calculus", "Quantum". */
	subject: z.string().min(1),
	summary: z.string().min(1),
	books: z.array(z.object({ bookId: id(), role: z.enum(["primary", "secondary", "reference"]) })).default([]),
	units: z.array(unitSchema).min(1),
	exams: z.array(examSchema).default([]),
});
export type Course = z.infer<typeof courseSchema>;

export const programSchema = z.object({
	id: id(),
	title: z.string().min(1),
	summary: z.string().min(1),
	/** Planned length and pace — the timeline's target. */
	targetWeeks: z.number().int().positive(),
	hoursPerWeek: z.number().positive(),
	/** Course ids in suggested order (each has a courses/<id>.json). */
	courses: z.array(id()).min(1),
});
export type ProgramMeta = z.infer<typeof programSchema>;

/** The loaded program: meta + its courses in order. */
export interface Program extends ProgramMeta {
	courseList: Course[];
}

// ─── Progress ledger (data/curriculum/progress.jsonl) ───────────────────────

const at = z.string(); // ISO timestamp

export const progressEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("lesson_started"), at, lessonId: id() }),
	z.object({ type: z.literal("session_linked"), at, lessonId: id(), chatId: z.string(), mode: z.enum(["teach", "practice"]) }),
	/** The learner finished the teaching session for a lesson. */
	z.object({ type: z.literal("lesson_completed"), at, lessonId: id() }),
	z.object({ type: z.literal("quick_check"), at, lessonId: id(), score: z.number().min(0).max(1) }),
	z.object({ type: z.literal("assessment_graded"), at, assessmentId: z.string(), kind: z.enum(["pset", "midterm", "final", "placement"]), courseId: id(), unitIds: z.array(id()), score: z.number().min(0).max(1) }),
	/** Lessons tested out by placement (counted as mastered). */
	z.object({ type: z.literal("placement"), at, lessonIds: z.array(id()) }),
	z.object({ type: z.literal("study_time"), at, minutes: z.number().positive().max(240), lessonId: id().optional(), source: z.enum(["heartbeat", "manual"]) }),
	z.object({ type: z.literal("review_done"), at, lessonId: id(), quality: z.number().int().min(0).max(5) }),
]);
export type ProgressEvent = z.infer<typeof progressEventSchema>;
export type ProgressEventType = ProgressEvent["type"];

export type LessonStatus = "locked" | "available" | "in-progress" | "mastered" | "review-due";
