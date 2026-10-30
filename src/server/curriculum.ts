/**
 * The physics program's server seam: the loaded spine (indexed), the
 * progress snapshot, ledger writes, and the lesson brief that seeds a
 * lesson session. Routes come through here (via the server barrel);
 * state derivation stays in core/progress.ts.
 */

import { indexProgram, type ProgramIndex } from "../core/curriculum.ts";
import { addDays, deriveProgress, isoDate, weekStart, type ProgressSnapshot } from "../core/progress.ts";
import { thenNowCandidate, weekSummary, type MotivationView } from "../core/motivation.ts";
import type { Lesson, Program, ProgressEvent } from "../core/contracts/curriculum.ts";
import type { LessonContextData } from "../core/native-messages.ts";
import { stores } from "./stores.ts";

let indexCache: { program: Program; index: ProgramIndex } | null = null;

export function programIndex(): ProgramIndex {
	const program = stores.curriculumStore.loadProgram();
	if (indexCache?.program !== program) indexCache = { program, index: indexProgram(program) };
	return indexCache.index;
}

export function progressSnapshot(now = new Date()): ProgressSnapshot {
	const settings = stores.curriculumStore.readSettings();
	return deriveProgress(programIndex(), stores.curriculumStore.readEvents(), {
		now,
		hoursPerWeek: settings.hoursPerWeek ?? undefined,
		parallelCourses: settings.parallelCourses ?? undefined,
		startDate: settings.startDate ?? undefined,
		unitWeeks: settings.unitWeeks,
		pauses: settings.pauses,
	});
}

export function motivationView(snapshot = progressSnapshot()): MotivationView {
	const events = stores.curriculumStore.readEvents();
	const today = isoDate(snapshot.now);
	const thisWeek = weekStart(today);
	const t = thenNowCandidate(events, snapshot, today);
	return {
		lastWeek: weekSummary(snapshot, events, addDays(thisWeek, -7)),
		thisWeek: weekSummary(snapshot, events, thisWeek),
		thenNow: t ? { ...t, lessonTitle: programIndex().lessons.get(t.lessonId)?.lesson.title ?? t.lessonId } : null,
	};
}

/** Append one ledger event after checking its references exist. */
export function recordProgress(event: ProgressEvent): void {
	const index = programIndex();
	const lessonIds = "lessonId" in event && event.lessonId ? [event.lessonId] : event.type === "placement" ? event.lessonIds : [];
	for (const id of lessonIds) if (!index.lessons.has(id)) throw new Error(`unknown lesson: ${id}`);
	if (event.type === "assessment_graded" && !index.courses.has(event.courseId)) throw new Error(`unknown course: ${event.courseId}`);
	stores.curriculumStore.appendEvent(event);
}

/** Readings resolved to page ranges by the bookshelf, when the book is
 *  ingested (registered by src/server/bookshelf.ts to keep this module
 *  free of the PDF stack). */
export interface ResolvedReading {
	bookId: string;
	label: string;
	ref: string;
	title: string;
	/** Printed page range, e.g. "66–80"; absent when the book isn't ingested. */
	pages?: string;
	/** Inclusive PDF page indices (1-based) for the reader. */
	pdfPages?: [number, number];
	ingested: boolean;
	optional: boolean;
}

type ReadingResolver = (lesson: Lesson) => ResolvedReading[];
let readingResolver: ReadingResolver | null = null;
export function setReadingResolver(fn: ReadingResolver): void {
	readingResolver = fn;
}

export function resolveReadings(lesson: Lesson): ResolvedReading[] {
	if (readingResolver) return readingResolver(lesson);
	const catalog = stores.curriculumStore.loadCatalog();
	return lesson.readings.map((r) => {
		const book = catalog.books.find((b) => b.id === r.bookId);
		return {
			bookId: r.bookId,
			label: `${book?.title ?? r.bookId} ${r.ref} ${r.title}`,
			ref: r.ref,
			title: r.title,
			ingested: false,
			optional: !!r.optional,
		};
	});
}

/** The brief for a unit's MIXED DRILL practice session: problems drawn
 *  across every lesson of the unit, shuffled and unlabelled, so the learner
 *  practises recognising which technique applies. */
export function unitDrillBrief(unitId: string): { content: string; details: LessonContextData } | null {
	const index = programIndex();
	const ref = index.units.get(unitId);
	if (!ref) return null;
	const { unit, course } = ref;
	const snapshot = progressSnapshot();
	const weak = unit.lessons
		.filter((l) => {
			const s = snapshot.lessons[l.id];
			return !!s && ((s.bestCheck !== null && s.bestCheck < 0.8) || s.missed.length > 0);
		})
		.map((l) => l.title);
	const lines = [
		`[Session context] — a MIXED DRILL across unit ${unit.id} of the learner's self-study physics program (an organic chemist working toward first-year-PhD physics).`,
		"",
		`Course: ${course.code} ${course.title}  ·  Unit: ${unit.title} — ${unit.summary}`,
		"",
		"The unit's lessons (objectives and key equations):",
		...unit.lessons.flatMap((l) => [
			`- ${l.title}`,
			...l.objectives.map((o) => `    - ${o}`),
			...(l.keyEquations.length ? [`    key equations: ${l.keyEquations.map((e) => `$${e}$`).join(" ; ")}`] : []),
		]),
	];
	if (weak.length) lines.push("", `Weak spots (low quiz scores or missed questions) — weight problems toward these: ${weak.join("; ")}.`);
	lines.push(
		"",
		"This is a MIXED DRILL practice session: give one problem at a time, drawn from across the whole unit in shuffled order. Never name the technique, the lesson, or the equation it needs — recognising which tool applies is the skill being practised. " +
			"After each answer, say which technique it was and why that was the right choice (what in the problem signalled it), then give the next problem. Keep each problem short (2–5 minutes).",
	);
	const first = unit.lessons[0];
	return {
		content: lines.join("\n"),
		details: {
			lessonId: first?.id ?? unit.id,
			courseCode: course.code,
			courseTitle: course.title,
			unitTitle: unit.title,
			lessonTitle: `Mixed drill · ${unit.title}`,
			mode: "practice",
			objectives: unit.lessons.map((l) => l.title),
			readings: [],
		},
	};
}

/** The brief for a TEACH-BACK session: the learner, having mastered the
 *  lesson, teaches it to the tutor playing a sharp but confused student. */
export function teachBackBrief(lessonId: string): { content: string; details: LessonContextData } | null {
	const base = lessonBrief(lessonId, "teach");
	const ref = programIndex().lessons.get(lessonId);
	if (!base || !ref) return null;
	const { lesson, unit, course } = ref;
	const lines = [
		`[Session context] — a TEACH-BACK session for lesson ${lesson.id} of the learner's self-study physics program (an organic chemist working toward first-year-PhD physics). The learner has mastered this lesson and will now teach it to you.`,
		"",
		`Course: ${course.code} ${course.title}  ·  Unit: ${unit.title}  ·  Lesson: ${lesson.title}`,
		"",
		"What a good explanation covers (do NOT show this list to the learner):",
		...lesson.objectives.map((o) => `- ${o}`),
		...(lesson.keyEquations.length ? ["", "Key equations:", ...lesson.keyEquations.map((e) => `- $${e}$`)] : []),
		"",
		"Play a sharp but genuinely confused student. Never lecture or explain the material yourself. Open by asking the learner to explain the lesson's main idea to you. " +
			"Then ask one short question at a time: why something is true, what happens in a limiting case or 'what if' variation, where an equation comes from, or how it connects to something in chemistry — probing especially where the explanation was vague or skipped a step. " +
			"Occasionally voice a plausible misconception and let the learner correct you. After 5–8 exchanges, or when the learner asks to stop, step out of the role and give a short summary: what they explained clearly, and the one or two points that were shaky, with the correct idea stated briefly.",
	];
	return { content: lines.join("\n"), details: { ...base.details, lessonTitle: `Teach it back · ${lesson.title}` } };
}

/** The model-facing brief + UI payload for a lesson-session marker. */
export function lessonBrief(lessonId: string, mode: "teach" | "practice"): { content: string; details: LessonContextData } | null {
	const index = programIndex();
	const ref = index.lessons.get(lessonId);
	if (!ref) return null;
	const { lesson, unit, course } = ref;
	const snapshot = progressSnapshot();
	const readings = resolveReadings(lesson);
	const position = unit.lessons.findIndex((l) => l.id === lesson.id);
	const earlier = unit.lessons.slice(Math.max(0, position - 3), position);
	const lp = snapshot.lessons[lessonId];
	const weak = index.lessonOrder
		.filter((id) => {
			const s = snapshot.lessons[id];
			return !!s && s.bestCheck !== null && s.bestCheck < 0.8 && index.lessons.get(id)!.course.id === course.id;
		})
		.slice(-5)
		.map((id) => `${index.lessons.get(id)!.lesson.title} (best quick check ${Math.round((snapshot.lessons[id]?.bestCheck ?? 0) * 100)}%)`);

	const lines = [
		`[Session context] — this session is lesson ${lesson.id} of the learner's self-study physics program (an organic chemist working toward first-year-PhD physics).`,
		"",
		`Course: ${course.code} ${course.title}  ·  Unit: ${unit.title}${unit.grad ? " (graduate-level extension)" : ""}`,
		`Lesson: ${lesson.title}  (~${lesson.minutes} min including reading)`,
		"",
		"Objectives — the lesson is done when each of these feels obviously true and the learner can do it:",
		...lesson.objectives.map((o) => `- ${o}`),
	];
	if (lesson.keyEquations.length) lines.push("", "Key equations:", ...lesson.keyEquations.map((e) => `- $${e}$`));
	if (readings.length) {
		lines.push("", "Assigned reading (the learner has these books; use the book tools to quote, cite pages, or pull exercises — read only the pages you need):");
		for (const r of readings)
			lines.push(`- ${r.label}${r.pages ? ` — printed pp. ${r.pages}` : ""}${r.ingested ? ` [book id: ${r.bookId}]` : " [not ingested yet]"}${r.optional ? " (optional)" : ""}`);
	}
	if (lesson.practice.length) lines.push("", `Textbook exercises that fit: ${lesson.practice.join("; ")}`);
	if (lesson.demoIdeas.length) lines.push("", `Demo ideas (build one when the concept is dynamic): ${lesson.demoIdeas.join(" | ")}`);
	if (earlier.length) lines.push("", `Just before this, the learner covered: ${earlier.map((l) => l.title).join("; ")}.`);
	if (weak.length) lines.push(`Weak spots in this course so far: ${weak.join("; ")}.`);
	if (lp?.bestCheck !== null && lp?.bestCheck !== undefined) lines.push(`Previous quick check on this lesson: ${Math.round(lp.bestCheck * 100)}%.`);
	lines.push(
		"",
		mode === "practice"
			? "This is a PRACTICE session for this lesson: problems at the level of the objectives, prefer the cited textbook exercises. With every problem, state the equation(s) it needs in display math (unless the problem asks the learner to derive or recall that equation)."
			: "Keep the probe short (the curriculum already places the learner): check the prerequisites this lesson leans on, then teach toward the objectives.",
		"The learner's goal is genuine understanding — why things are true and how they explain the real world (tie to everyday phenomena and chemistry) — with fluent use of the equations and calculations, not problem drilling.",
	);

	return {
		content: lines.join("\n"),
		details: {
			lessonId,
			courseCode: course.code,
			courseTitle: course.title,
			unitTitle: unit.title,
			lessonTitle: lesson.title,
			mode,
			objectives: lesson.objectives,
			readings: readings.map((r) => ({ label: r.label, pages: r.pages })),
		},
	};
}

// ─── Client views ───────────────────────────────────────────────────────────

/** The lean program the Program UI renders everywhere (map, timeline,
 *  course pages): structure + flags, no lesson bodies. */
export interface ProgramView {
	id: string;
	title: string;
	summary: string;
	targetWeeks: number;
	hoursPerWeek: number;
	courses: {
		id: string;
		code: string;
		title: string;
		track: string;
		depth: string;
		hours: number;
		prereqs: string[];
		coreqs: string[];
		subject: string;
		summary: string;
		exams: { id: string; kind: string; title: string; minutes: number; passMark: number; covers: string[] }[];
		units: {
			id: string;
			title: string;
			summary: string;
			grad: boolean;
			lessons: { id: string; title: string; minutes: number; lectures: number; demos: number; prereqs: string[] }[];
		}[];
	}[];
}

export function programView(): ProgramView {
	const { program } = programIndex();
	return {
		id: program.id,
		title: program.title,
		summary: program.summary,
		targetWeeks: program.targetWeeks,
		hoursPerWeek: program.hoursPerWeek,
		courses: program.courseList.map((c) => ({
			id: c.id,
			code: c.code,
			title: c.title,
			track: c.track,
			depth: c.depth,
			hours: c.hours,
			prereqs: c.prereqs,
			coreqs: c.coreqs,
			subject: c.subject,
			summary: c.summary,
			exams: c.exams.map((e) => ({ id: e.id, kind: e.kind, title: e.title, minutes: e.minutes, passMark: e.passMark, covers: e.covers })),
			units: c.units.map((u) => ({
				id: u.id,
				title: u.title,
				summary: u.summary,
				grad: !!u.grad,
				lessons: u.lessons.map((l) => ({
					id: l.id,
					title: l.title,
					minutes: l.minutes,
					lectures: l.lectures.length,
					demos: l.demoIdeas.length,
					prereqs: l.prereqs,
				})),
			})),
		})),
	};
}

/** Everything the lesson page shows. */
export function lessonDetail(lessonId: string) {
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) return null;
	const { lesson, unit, course } = ref;
	const siblings = unit.lessons.map((l) => ({ id: l.id, title: l.title }));
	const all = programIndex().lessonOrder;
	const i = all.indexOf(lessonId);
	return {
		lesson,
		unit: { id: unit.id, title: unit.title, summary: unit.summary, grad: !!unit.grad },
		course: { id: course.id, code: course.code, title: course.title, track: course.track },
		readings: resolveReadings(lesson),
		siblings,
		prevId: i > 0 ? all[i - 1]! : null,
		nextId: i >= 0 && i < all.length - 1 ? all[i + 1]! : null,
	};
}
export type LessonDetail = NonNullable<ReturnType<typeof lessonDetail>>;
