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
	/** Watch length in minutes (the clip when start/end are set). */
	minutes: z.number().positive().optional(),
	/** An extra lecture, under "More lectures" — not part of the lesson's time. */
	optional: z.boolean().optional(),
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

export const TRACKS = ["math", "physics", "chemphys", "survey", "capstone", "elective"] as const;
export type Track = (typeof TRACKS)[number];

export const courseSchema = z.object({
	id: id(),
	code: z.string().min(1),
	title: z.string().min(1),
	track: z.enum(TRACKS),
	depth: z.enum(["core", "survey", "capstone", "elective"]),
	hours: z.number().positive(),
	/** Course ids that must be passed (or substantially done) first. */
	prereqs: z.array(id()).default([]),
	/** Courses meant to be taken ALONGSIDE this one (Calculus I with
	 *  Physics I, as at a university). Never blocking — they shape the
	 *  schedule and the "take with" hint, not what's unlocked. */
	coreqs: z.array(id()).default([]),
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

// ─── Assessments (generated once, cached under data/curriculum/) ────────────

/** A quick-check question. mc/numeric grade deterministically; short
 *  answers are judged against the rubric by the cheap model. */
/** `equations`: the LaTeX the question needs, shown under its prompt
 *  (never one that is itself the answer). */
export type CheckQuestion =
	| { kind: "mc"; prompt: string; options: string[]; answer: number; explanation: string; equations?: string[] }
	| { kind: "numeric"; prompt: string; answer: number; tolerance: number; unit?: string; explanation: string; equations?: string[] }
	| { kind: "short"; prompt: string; rubric: string; modelAnswer: string; equations?: string[] };

export interface QuickCheck {
	lessonId: string;
	createdAt: string;
	questions: CheckQuestion[];
}

export interface CheckResult {
	lessonId: string;
	at: string;
	score: number;
	perQuestion: { correct: boolean; credit: number; feedback: string }[];
}

export type AssessmentKind = "pset" | "midterm" | "final" | "placement";

export interface AssessmentProblem {
	id: string;
	unitId: string;
	lessonIds: string[];
	/** Markdown with $…$ / $$…$$ math. */
	prompt: string;
	/** LaTeX of the equations the problem needs, shown with it. */
	equations?: string[];
	points: number;
	/** Point-bearing criteria, e.g. "2 pts: sets up Gauss's law with a spherical surface". */
	rubric: string[];
	/** Full worked solution (markdown + math), revealed after grading. */
	solution: string;
	/** Provenance, e.g. "Griffiths EM 4e Problem 2.15 (adapted)". */
	source?: string;
}

export interface ProblemAnswer {
	text: string;
	/** Uploaded photo file names (data/curriculum/uploads/). */
	images: string[];
}

export interface ProblemGrade {
	problemId: string;
	points: number;
	max: number;
	feedback: string;
	/** Where the reasoning first went wrong, when it did. */
	firstError?: string;
}

export interface Assessment {
	id: string;
	kind: AssessmentKind;
	courseId: string;
	unitIds: string[];
	/** The exam definition id (spine), absent for unit problem sets. */
	examId?: string;
	title: string;
	/** Time limit in minutes (exams/placement); null = untimed. */
	minutes: number | null;
	closedBook: boolean;
	passMark: number;
	status: "generating" | "ready" | "in-progress" | "grading" | "graded" | "error";
	error?: string;
	createdAt: string;
	problems: AssessmentProblem[];
	startedAt?: string;
	submittedAt?: string;
	answers: Record<string, ProblemAnswer>;
	grade?: {
		score: number;
		perProblem: ProblemGrade[];
		summary: string;
		/** Placement: lessons tested out (units scored ≥ passMark). */
		testedOut?: string[];
		gradedAt: string;
	};
}

// ─── Authored quick checks (curriculum/physics/checks/<courseId>.json) ──────

const equations = z.array(z.string().min(1)).max(4).optional();

export const checkQuestionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("mc"),
		prompt: z.string().min(1),
		options: z.array(z.string().min(1)).min(3).max(5),
		answer: z.number().int().min(0),
		explanation: z.string().min(1),
		equations,
	}),
	z.object({
		kind: z.literal("numeric"),
		prompt: z.string().min(1),
		answer: z.number(),
		tolerance: z.number().min(0.001).max(0.2),
		unit: z.string().optional(),
		explanation: z.string().min(1),
		equations,
	}),
	z.object({ kind: z.literal("short"), prompt: z.string().min(1), rubric: z.string().min(1), modelAnswer: z.string().min(1), equations }),
]);

/** One course's authored quick checks: lessonId → its questions. Shipped
 *  with the spine; the app falls back to generating (and caching) a check
 *  only for lessons that have none here. */
export const courseChecksSchema = z.object({
	courseId: id(),
	checks: z.record(z.string(), z.array(checkQuestionSchema).min(3).max(6)),
});
export type CourseChecks = z.infer<typeof courseChecksSchema>;
