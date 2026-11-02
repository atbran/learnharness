/**
 * Progress derivation — the ONLY place learner state is computed. Input:
 * the static program index + the append-only progress ledger + "now".
 * Output: a snapshot the Program UI renders (statuses, mastery, pace,
 * schedule, review queue, XP/streak/badges). Pure and deterministic:
 * nothing here is ever stored.
 */

import type { LessonStatus, ProgressEvent } from "./contracts/curriculum.ts";
import { lessonPrereqs, type ProgramIndex } from "./curriculum.ts";

export const MASTERY_CHECK = 0.8;
export const UNIT_PASS = 0.7;
export const STREAK_MINUTES = 15;
/** Lessons finished (quiz-mastered or tested out) for a week to count. */
export const WEEKLY_LESSONS = 3;
const DAY = 86_400_000;

export interface ReviewState {
	reps: number;
	ease: number;
	intervalDays: number;
	due: string; // ISO date (yyyy-mm-dd)
}

export interface LessonProgress {
	status: LessonStatus;
	bestCheck: number | null;
	started: boolean;
	completed: boolean;
	testedOut: boolean;
	masteredAt: string | null;
	/** What mastered it: a passing quick check, the tutor's call in a lesson
	 *  session (backed by a passed check on every plan step), or a test-out. */
	masteredBy: "check" | "tutor" | "placement" | null;
	sessions: { chatId: string; mode: "teach" | "practice"; at: string }[];
	review: ReviewState | null;
	minutesStudied: number;
	/** A unit diagnostic got one of this lesson's two questions: what was missed. */
	diagnostic: { at: string; missed: { prompt: string; explanation: string }[] } | null;
	/** Quiz questions (indexes) answered wrong last time; they come back in review. */
	missed: number[];
	missedAt: string | null;
}

/** A unit's target window from its target weeks (unitWeeks). */
export interface UnitPace {
	targetStart: string;
	targetEnd: string;
	weeks: number;
	lessonsLeft: number;
	/** Lessons per day needed to finish by targetEnd (0 when done). */
	perDayNeeded: number;
	status: "upcoming" | "ahead" | "on-track" | "behind" | "done";
}

export interface AssessmentResult {
	assessmentId: string;
	kind: "pset" | "midterm" | "final" | "placement" | "worksheet";
	courseId: string;
	unitIds: string[];
	score: number;
	at: string;
}

export interface CourseProgress {
	lessonsTotal: number;
	lessonsMastered: number;
	/** Mastered lesson minutes / total lesson minutes. */
	fraction: number;
	status: "locked" | "available" | "active" | "passed";
	midterm: number | null;
	final: number | null;
	psetAverage: number | null;
	firstActivity: string | null;
	passedAt: string | null;
}

export interface CourseWindow {
	courseId: string;
	startWeek: number;
	endWeek: number;
}

export interface Badge {
	id: string;
	title: string;
	description: string;
	earnedAt: string | null;
}

export interface ProgressSnapshot {
	now: string;
	startDate: string;
	lessons: Record<string, LessonProgress>;
	units: Record<string, { psetBest: number | null; passed: boolean; mastered: number; total: number; diagnosedAt: string | null; pace: UnitPace | null }>;
	courses: Record<string, CourseProgress>;
	assessments: AssessmentResult[];
	subjects: { subject: string; mastery: number; hours: number }[];
	study: {
		byDate: Record<string, number>;
		totalMinutes: number;
		thisWeekMinutes: number;
		weekTargetMinutes: number;
	};
	pace: {
		hoursPerWeekTarget: number;
		recentHoursPerWeek: number;
		plannedHours: number;
		doneHours: number;
		remainingHours: number;
		targetFinish: string;
		projectedFinish: string;
		slipWeeks: number;
	};
	plan: CourseWindow[];
	projection: CourseWindow[];
	/** Courses studied in parallel (the schedule's lanes). */
	parallel: number;
	next: string[];
	reviewsDue: string[];
	/** Lessons with missed quiz questions from before today. */
	missedDue: string[];
	xp: number;
	level: { level: number; xpIntoLevel: number; xpForLevel: number };
	/** The daily chain: days with ≥ STREAK_MINUTES (paused days skipped). */
	streak: { current: number; best: number };
	/** The main streak: Monday-weeks in a row with ≥ WEEKLY_LESSONS finished. */
	weekly: { current: number; best: number; thisWeek: { weekStart: string; finished: number; target: number } };
	/** The pause in effect today, if any. */
	paused: Pause | null;
	/** Courses whose optional capstone project is marked done (off the path:
	 *  never touches mastery, unlocking, pace or the streak). */
	projectsDone: string[];
	badges: Badge[];
}

export interface ProgressOptions {
	now: Date;
	hoursPerWeek?: number;
	/** Courses studied at once (default 3: e.g. math + physics + enrichment). */
	parallelCourses?: number;
	/** Explicit program start; defaults to the first ledger event or now. */
	startDate?: string;
	/** Target weeks per unit (unitId → weeks). */
	unitWeeks?: Record<string, number>;
	/** Breaks the learner declared: streaks and pace windows skip them. */
	pauses?: readonly Pause[];
}

export interface Pause {
	start: string;
	end: string;
	reason?: string;
}

/** The learner's local calendar day (yyyy-mm-dd) of a timestamp — the
 *  server runs on their own PC, so an evening session stays on its day
 *  (UTC would roll Memphis evenings over into tomorrow). A yyyy-mm-dd
 *  string is already a day and passes through. */
export function isoDate(d: Date | string): string {
	if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
	const t = typeof d === "string" ? new Date(d) : d;
	return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** Calendar arithmetic on yyyy-mm-dd days (no time zone involved). */
export function addDays(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Monday-start ISO week key for a yyyy-mm-dd date. */
export function weekStart(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	const dow = (d.getUTCDay() + 6) % 7;
	return addDays(date, -dow);
}

// ─── SM-2 ───────────────────────────────────────────────────────────────────

export function initialReview(masteredDate: string): ReviewState {
	return { reps: 0, ease: 2.5, intervalDays: 3, due: addDays(masteredDate, 3) };
}

/** One SM-2 step with review quality 0..5 on `date`. */
export function nextReview(prev: ReviewState, quality: number, date: string): ReviewState {
	const q = Math.max(0, Math.min(5, quality));
	const ease = Math.max(1.3, prev.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
	if (q < 3) return { reps: 0, ease, intervalDays: 1, due: addDays(date, 1) };
	const reps = prev.reps + 1;
	const intervalDays = reps === 1 ? 7 : reps === 2 ? 16 : Math.round(prev.intervalDays * ease);
	return { reps, ease, intervalDays, due: addDays(date, intervalDays) };
}

// ─── XP / levels ────────────────────────────────────────────────────────────

export const XP = {
	lessonMastered: 100,
	quickCheckPerPoint: 20,
	testedOutLesson: 25,
	pset: 150,
	midterm: 300,
	final: 500,
	placement: 100,
	worksheet: 100,
	review: 15,
	perStudyMinute: 0.5,
} as const;

export function levelFor(xp: number): ProgressSnapshot["level"] {
	// Level n starts at 250 * n * (n - 1) / 2 XP: 0, 250, 750, 1500, …
	let level = 1;
	while (250 * ((level + 1) * level) / 2 <= xp) level++;
	const start = (250 * level * (level - 1)) / 2;
	const end = (250 * (level + 1) * level) / 2;
	return { level, xpIntoLevel: Math.round(xp - start), xpForLevel: end - start };
}

// ─── Schedule simulation ────────────────────────────────────────────────────

/** Week-by-week simulation: each week, the (at most `parallel`) earliest
 *  courses in program order whose prerequisite courses are finished share
 *  the week's hours. A course in `fixedWeeks` (its units all have target
 *  weeks) instead runs for exactly that many weeks in its lane, drawing
 *  nothing from the shared hours. Returns each course's window in weeks
 *  from week 0. */
export function simulateSchedule(
	index: ProgramIndex,
	remainingHours: Record<string, number>,
	hoursPerWeek: number,
	parallel = 3,
	maxWeeks = 1500,
	fixedWeeks: Record<string, number> = {},
): CourseWindow[] {
	const order = index.program.courseList.map((c) => c.id);
	const left = { ...remainingHours };
	const fixedLeft = { ...fixedWeeks };
	const isFixed = (id: string) => fixedWeeks[id] !== undefined;
	const start: Record<string, number> = {};
	const end: Record<string, number> = {};
	for (const id of order) if (isFixed(id) ? (fixedLeft[id] ?? 0) <= 1e-9 : (left[id] ?? 0) <= 1e-9) end[id] = 0;
	for (let week = 0; week < maxWeeks && Object.keys(end).length < order.length; week++) {
		const ready = order.filter(
			(id) => end[id] === undefined && index.courses.get(id)!.prereqs.every((p) => !index.courses.has(p) || (end[p] !== undefined && end[p]! <= week)),
		);
		const active = ready.slice(0, parallel);
		if (active.length === 0) break;
		for (const id of active.filter(isFixed)) {
			start[id] ??= week;
			fixedLeft[id] = (fixedLeft[id] ?? 0) - 1;
			if ((fixedLeft[id] ?? 0) <= 1e-9) end[id] = week + 1;
		}
		let budget = hoursPerWeek;
		// Split evenly; hours a finishing course doesn't need flow to the other.
		for (let pass = 0; pass < 2 && budget > 1e-9; pass++) {
			const open = active.filter((id) => !isFixed(id) && (left[id] ?? 0) > 1e-9);
			if (open.length === 0) break;
			const share = budget / open.length;
			for (const id of open) {
				start[id] ??= week;
				const used = Math.min(share, left[id] ?? 0);
				left[id] = (left[id] ?? 0) - used;
				budget -= used;
			}
		}
		for (const id of active) if (!isFixed(id) && (left[id] ?? 0) <= 1e-9 && end[id] === undefined) end[id] = week + 1;
	}
	return order.map((id) => ({ courseId: id, startWeek: start[id] ?? 0, endWeek: end[id] ?? maxWeeks }));
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export function deriveProgress(index: ProgramIndex, events: readonly ProgressEvent[], opts: ProgressOptions): ProgressSnapshot {
	const nowIso = opts.now.toISOString();
	const today = isoDate(opts.now);
	const hoursPerWeek = opts.hoursPerWeek ?? index.program.hoursPerWeek;
	const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
	const startDate = opts.startDate ?? (sorted[0] ? isoDate(sorted[0].at) : today);

	const pauses = opts.pauses ?? [];
	const isPaused = (d: string) => pauses.some((p) => p.start <= d && d <= p.end);
	/** Paused days in [from, to). */
	const pausedDays = (from: string, to: string) => {
		let n = 0;
		for (let d = from; d < to && n < 3660; d = addDays(d, 1)) if (isPaused(d)) n++;
		return n;
	};

	const lessons: Record<string, LessonProgress> = {};
	for (const id of index.lessonOrder)
		lessons[id] = {
			status: "locked",
			bestCheck: null,
			started: false,
			completed: false,
			testedOut: false,
			masteredAt: null,
			masteredBy: null,
			sessions: [],
			review: null,
			minutesStudied: 0,
			diagnostic: null,
			missed: [],
			missedAt: null,
		};

	const L = (id: string): LessonProgress => lessons[id]!;
	const assessments: AssessmentResult[] = [];
	const byDate: Record<string, number> = {};
	let xp = 0;
	let reviewsDone = 0;
	let perfectChecks = 0;
	const diagnosedAt: Record<string, string> = {};
	const projectsDone: string[] = [];

	const markMastered = (id: string, at: string, by: NonNullable<LessonProgress["masteredBy"]>) => {
		const l = L(id);
		if (!l || l.masteredAt) return;
		l.masteredAt = at;
		l.masteredBy = by;
		l.review = initialReview(isoDate(at));
	};

	for (const ev of sorted) {
		switch (ev.type) {
			case "lesson_started":
				if (L(ev.lessonId)) L(ev.lessonId).started = true;
				break;
			case "session_linked":
				if (L(ev.lessonId)) {
					L(ev.lessonId).started = true;
					L(ev.lessonId).sessions.push({ chatId: ev.chatId, mode: ev.mode, at: ev.at });
				}
				break;
			case "lesson_completed":
				if (L(ev.lessonId)) L(ev.lessonId).completed = true;
				break;
			case "quick_check": {
				const l = L(ev.lessonId);
				if (!l) break;
				l.started = true;
				// An override re-scores an attempt already counted: no XP twice.
				if (!ev.overridden) {
					xp += XP.quickCheckPerPoint * ev.score * 5;
					if (ev.score >= 0.999) perfectChecks++;
				}
				l.bestCheck = Math.max(l.bestCheck ?? 0, ev.score);
				if (ev.missed) {
					l.missed = ev.missed;
					l.missedAt = ev.at;
				}
				if (ev.score >= MASTERY_CHECK && !l.masteredAt) {
					markMastered(ev.lessonId, ev.at, "check");
					xp += XP.lessonMastered;
				}
				break;
			}
			case "tutor_mastered": {
				const l = L(ev.lessonId);
				if (!l || l.masteredAt) break;
				l.started = true;
				markMastered(ev.lessonId, ev.at, "tutor");
				xp += XP.lessonMastered;
				break;
			}
			case "placement":
				for (const id of ev.lessonIds) {
					if (!L(id) || L(id).masteredAt) continue;
					L(id).testedOut = true;
					markMastered(id, ev.at, "placement");
					xp += XP.testedOutLesson;
				}
				break;
			case "diagnostic": {
				diagnosedAt[ev.unitId] = ev.at;
				const l = L(ev.lessonId);
				// An empty `missed` is a full miss: the unit is diagnosed, the lesson stays whole.
				if (!l || l.masteredAt || ev.missed.length === 0) break;
				l.started = true;
				l.diagnostic = { at: ev.at, missed: ev.missed };
				break;
			}
			case "then_now": {
				const l = L(ev.lessonId);
				if (!l) break;
				xp += XP.review;
				// Still wrong: it goes back into the missed-question review.
				if (!ev.correct && !l.missed.includes(ev.question)) {
					l.missed = [...l.missed, ev.question];
					l.missedAt = ev.at;
				}
				break;
			}
			case "missed_retake": {
				const l = L(ev.lessonId);
				if (!l) break;
				l.missed = ev.missed;
				l.missedAt = ev.at;
				break;
			}
			case "assessment_graded":
				assessments.push({ assessmentId: ev.assessmentId, kind: ev.kind, courseId: ev.courseId, unitIds: ev.unitIds, score: ev.score, at: ev.at });
				if (ev.kind === "placement") for (const u of ev.unitIds) diagnosedAt[u] ??= ev.at;
				xp += XP[ev.kind] * ev.score;
				break;
			case "study_time": {
				const d = isoDate(ev.at);
				byDate[d] = (byDate[d] ?? 0) + ev.minutes;
				if (ev.lessonId && L(ev.lessonId)) L(ev.lessonId).minutesStudied += ev.minutes;
				xp += XP.perStudyMinute * ev.minutes;
				break;
			}
			case "project_done":
				if (!projectsDone.includes(ev.courseId)) projectsDone.push(ev.courseId);
				break;
			case "review_done": {
				const l = L(ev.lessonId);
				if (!l?.review) break;
				l.review = nextReview(l.review, ev.quality, isoDate(ev.at));
				reviewsDone++;
				xp += XP.review;
				break;
			}
		}
	}

	// Statuses.
	for (const id of index.lessonOrder) {
		const l = L(id);
		if (l.masteredAt) l.status = l.review && l.review.due <= today ? "review-due" : "mastered";
		else if (l.started || l.completed || l.bestCheck !== null) l.status = "in-progress";
		else l.status = lessonPrereqs(index, id).every((p) => L(p).masteredAt) ? "available" : "locked";
	}

	// Units.
	const units: ProgressSnapshot["units"] = {};
	for (const [unitId, { unit }] of index.units) {
		const psets = assessments.filter((a) => a.kind === "pset" && a.unitIds.includes(unitId));
		const psetBest = psets.length ? Math.max(...psets.map((a) => a.score)) : null;
		const mastered = unit.lessons.filter((l) => L(l.id).masteredAt).length;
		units[unitId] = {
			psetBest,
			passed: psetBest !== null && psetBest >= UNIT_PASS,
			mastered,
			total: unit.lessons.length,
			diagnosedAt: diagnosedAt[unitId] ?? null,
			pace: null,
		};
	}

	// Courses.
	const courses: ProgressSnapshot["courses"] = {};
	const remainingHours: Record<string, number> = {};
	let doneHours = 0;
	for (const course of index.program.courseList) {
		const all = course.units.flatMap((u) => u.lessons);
		const total = all.reduce((s, l) => s + l.minutes, 0) || 1;
		const masteredMin = all.filter((l) => L(l.id).masteredAt).reduce((s, l) => s + l.minutes, 0);
		const best = (kind: AssessmentResult["kind"]) => {
			const xs = assessments.filter((a) => a.courseId === course.id && a.kind === kind);
			return xs.length ? Math.max(...xs.map((a) => a.score)) : null;
		};
		const psetScores = course.units.map((u) => units[u.id]!.psetBest).filter((s): s is number => s !== null);
		const finalExam = course.exams.find((e) => e.kind === "final");
		const final = best("final");
		const passedEvent = finalExam
			? assessments.find((a) => a.courseId === course.id && a.kind === "final" && a.score >= finalExam.passMark)
			: undefined;
		const fraction = masteredMin / total;
		const activity = all
			.flatMap((l) => [L(l.id).masteredAt, ...L(l.id).sessions.map((s) => s.at)])
			.filter((x): x is string => !!x)
			.sort();
		const prereqsDone = course.prereqs.every((p) => {
			const pc = index.courses.get(p);
			return pc ? pc.units.at(-1)?.lessons.at(-1) && L(pc.units.at(-1)!.lessons.at(-1)!.id).masteredAt : true;
		});
		const passed = !!passedEvent || (fraction >= 0.999 && !finalExam);
		courses[course.id] = {
			lessonsTotal: all.length,
			lessonsMastered: all.filter((l) => L(l.id).masteredAt).length,
			fraction,
			status: passed ? "passed" : activity.length ? "active" : prereqsDone ? "available" : "locked",
			midterm: best("midterm"),
			final,
			psetAverage: psetScores.length ? psetScores.reduce((a, b) => a + b, 0) / psetScores.length : null,
			firstActivity: activity[0] ?? null,
			passedAt: passedEvent?.at ?? null,
		};
		const credit = passed ? 1 : Math.min(1, fraction);
		doneHours += course.hours * credit;
		remainingHours[course.id] = course.hours * (1 - credit);
	}

	// Subjects (radar): mastered share of lesson minutes, nudged by exams.
	const subjMap = new Map<string, { total: number; mastered: number; examSum: number; examN: number }>();
	for (const course of index.program.courseList) {
		for (const unit of course.units)
			for (const l of unit.lessons) {
				const key = l.subject ?? course.subject;
				const s = subjMap.get(key) ?? { total: 0, mastered: 0, examSum: 0, examN: 0 };
				s.total += l.minutes;
				if (L(l.id).masteredAt) s.mastered += l.minutes;
				subjMap.set(key, s);
			}
		const s = subjMap.get(course.subject);
		const c = courses[course.id]!;
		for (const v of [c.midterm, c.final]) if (s && v !== null) { s.examSum += v; s.examN++; }
	}
	const subjects = [...subjMap.entries()].map(([subject, s]) => {
		const coverage = s.mastered / (s.total || 1);
		const exam = s.examN ? s.examSum / s.examN : null;
		// Exams scale coverage: a weak final pulls mastery below raw coverage.
		return { subject, mastery: exam === null ? coverage : coverage * (0.7 + 0.3 * exam), hours: s.total / 60 };
	});

	// Study time + pace.
	const totalMinutes = Object.values(byDate).reduce((a, b) => a + b, 0);
	const thisWeek = weekStart(today);
	const thisWeekMinutes = Object.entries(byDate).filter(([d]) => d >= thisWeek).reduce((s, [, m]) => s + m, 0);
	const fourWeeksAgo = addDays(today, -28);
	const recentMinutes = Object.entries(byDate).filter(([d]) => d > fourWeeksAgo).reduce((s, [, m]) => s + m, 0);
	const activeDays = Math.min(28, (Date.parse(today) - Date.parse(startDate)) / DAY) - pausedDays(fourWeeksAgo, today);
	const weeksActive = Math.min(4, Math.max(1, activeDays / 7));
	const recentHoursPerWeek = recentMinutes / 60 / weeksActive;
	const plannedHours = index.program.courseList.reduce((s, c) => s + c.hours, 0);
	const fullHours = Object.fromEntries(index.program.courseList.map((c) => [c.id, c.hours]));
	const parallel = Math.max(1, Math.min(6, opts.parallelCourses ?? 3));
	// Unit targets: a course whose units all have target weeks runs a
	// fixed-length lane (the unmastered share of each unit's weeks remains).
	const unitWeeks = opts.unitWeeks ?? {};
	const fixedFull: Record<string, number> = {};
	const fixedLeft: Record<string, number> = {};
	for (const course of index.program.courseList) {
		if (!course.units.length || !course.units.every((u) => unitWeeks[u.id] !== undefined)) continue;
		fixedFull[course.id] = course.units.reduce((s, u) => s + unitWeeks[u.id]!, 0);
		fixedLeft[course.id] =
			courses[course.id]!.status === "passed"
				? 0
				: course.units.reduce((s, u) => s + unitWeeks[u.id]! * (1 - units[u.id]!.mastered / (units[u.id]!.total || 1)), 0);
	}
	const plan = simulateSchedule(index, fullHours, index.program.hoursPerWeek, parallel, 1500, fixedFull);
	// A pace needs history: in the first two weeks a few logged minutes
	// would project decades, so the plan's pace stands in.
	const settled = Date.parse(today) - Date.parse(startDate) >= 14 * DAY;
	const projectionPace = settled && recentMinutes > 0 ? Math.max(1, recentHoursPerWeek) : hoursPerWeek;
	const weeksSoFar = Math.max(0, Math.floor((Date.parse(today) - Date.parse(startDate)) / (7 * DAY)));
	const projection = simulateSchedule(index, remainingHours, projectionPace, parallel, 1500, fixedLeft).map((w) =>
		(fixedLeft[w.courseId] ?? remainingHours[w.courseId]!) <= 1e-9
			? { ...w, startWeek: 0, endWeek: 0 }
			: { ...w, startWeek: w.startWeek + weeksSoFar, endWeek: w.endWeek + weeksSoFar },
	);

	// Unit pace: a course with any unit targets lays its units end to end
	// from its first activity (or projected start); untargeted units get the
	// weeks their minutes take at the course's share of the weekly hours.
	for (const course of index.program.courseList) {
		if (!course.units.some((u) => unitWeeks[u.id] !== undefined)) continue;
		const first = courses[course.id]!.firstActivity;
		const win = projection.find((w) => w.courseId === course.id);
		let cursor = first ? isoDate(first) : addDays(startDate, (win?.startWeek ?? weeksSoFar) * 7);
		const share = hoursPerWeek / parallel;
		for (const u of course.units) {
			const x = units[u.id]!;
			const weeks = unitWeeks[u.id] ?? Math.max(0.25, u.lessons.reduce((s, l) => s + l.minutes, 0) / 60 / share);
			const span0 = Math.max(1, Math.round(weeks * 7));
			// A pause inside the window pushes its end out by the paused days.
			const targetEnd = addDays(cursor, span0 + pausedDays(cursor, addDays(cursor, span0)));
			const lessonsLeft = x.total - x.mastered;
			const span = Date.parse(targetEnd) - Date.parse(cursor);
			const elapsed = Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(cursor)) / span));
			const daysLeft = Math.max(1, (Date.parse(targetEnd) - Date.parse(today > cursor ? today : cursor)) / DAY);
			const done = x.mastered / (x.total || 1);
			const status: UnitPace["status"] =
				lessonsLeft === 0
					? "done"
					: today < cursor && x.mastered === 0
						? "upcoming"
						: done >= elapsed + 0.1
							? "ahead"
							: done < elapsed - 0.1
								? "behind"
								: "on-track";
			x.pace = { targetStart: cursor, targetEnd, weeks, lessonsLeft, perDayNeeded: lessonsLeft ? lessonsLeft / daysLeft : 0, status };
			cursor = targetEnd;
		}
	}
	const targetWeeks = Math.max(...plan.map((w) => w.endWeek), index.program.targetWeeks);
	const projectedWeeks = Math.max(weeksSoFar, ...projection.map((w) => w.endWeek));
	const targetFinish = addDays(startDate, targetWeeks * 7);
	const projectedFinish = addDays(startDate, projectedWeeks * 7);

	// Streak: consecutive days with ≥ STREAK_MINUTES; one missed day per
	// Monday-week is forgiven (a "freeze"). Today may still be in progress.
	const qualifies = (d: string) => (byDate[d] ?? 0) >= STREAK_MINUTES;
	const streakAt = (end: string) => {
		let n = 0;
		const frozen = new Set<string>();
		let d = end;
		for (let i = 0; i < 5000; i++) {
			if (qualifies(d)) n++;
			else if (isPaused(d)) {
				/* a paused day neither counts nor breaks the chain */
			} else {
				const wk = weekStart(d);
				if (n === 0 || frozen.has(wk) || !qualifies(addDays(d, -1))) break;
				frozen.add(wk);
			}
			d = addDays(d, -1);
		}
		return n;
	};
	const current = qualifies(today) ? streakAt(today) : streakAt(addDays(today, -1));
	let best = current;
	for (const d of Object.keys(byDate)) if (qualifies(d) && !qualifies(addDays(d, 1))) best = Math.max(best, streakAt(d));

	// Weekly streak: Monday-weeks with ≥ WEEKLY_LESSONS lessons finished
	// (mastered by quiz or tested out). A week at least half paused neither
	// counts nor breaks it; this week joins once it reaches the target.
	const finishedByWeek = new Map<string, number>();
	for (const id of index.lessonOrder) {
		const m = L(id).masteredAt;
		if (m) finishedByWeek.set(weekStart(isoDate(m)), (finishedByWeek.get(weekStart(isoDate(m))) ?? 0) + 1);
	}
	const weekPaused = (wk: string) => pausedDays(wk, addDays(wk, 7)) >= 4;
	const weekMet = (wk: string) => (finishedByWeek.get(wk) ?? 0) >= WEEKLY_LESSONS;
	const firstWeek = weekStart(startDate);
	const runEndingAt = (wk: string) => {
		let n = 0;
		for (let w = wk; w >= firstWeek; w = addDays(w, -7)) {
			if (weekMet(w)) n++;
			else if (!weekPaused(w)) break;
		}
		return n;
	};
	const lastWeek = addDays(thisWeek, -7);
	const weeklyCurrent = (weekMet(thisWeek) ? 1 : 0) + runEndingAt(lastWeek);
	let weeklyBest = weeklyCurrent;
	for (let w = firstWeek; w < thisWeek; w = addDays(w, 7)) if (weekMet(w)) weeklyBest = Math.max(weeklyBest, runEndingAt(w));
	const weekly = { current: weeklyCurrent, best: weeklyBest, thisWeek: { weekStart: thisWeek, finished: finishedByWeek.get(thisWeek) ?? 0, target: WEEKLY_LESSONS } };

	// Next up / reviews.
	const reviewsDue = index.lessonOrder.filter((id) => L(id).status === "review-due");
	const inProgress = index.lessonOrder.filter((id) => L(id).status === "in-progress");
	const activeCourses = new Set(projection.filter((w) => w.startWeek <= weeksSoFar && w.endWeek > weeksSoFar).map((w) => w.courseId));
	const available = index.lessonOrder.filter((id) => L(id).status === "available");
	// Interleaved: one lesson per active course (its in-progress lessons
	// first), then the next round — not the first course filling the list.
	const courseOf = (id: string) => index.lessons.get(id)!.course.id;
	const queues = index.program.courseList
		.map((c) => c.id)
		.filter((cid) => activeCourses.has(cid) || inProgress.some((id) => courseOf(id) === cid))
		.map((cid) => [...inProgress, ...available].filter((id) => courseOf(id) === cid));
	const rounds: string[] = [];
	for (let i = 0; rounds.length < 6 && queues.some((q) => q.length > i); i++) for (const q of queues) {
		const id = q[i];
		if (id) rounds.push(id);
	}
	const next = [...new Set([...rounds, ...inProgress, ...available])].slice(0, 6);
	const missedDue = index.lessonOrder.filter((id) => {
		const l = L(id);
		return l.missed.length > 0 && l.missedAt !== null && isoDate(l.missedAt) < today;
	});

	// Badges.
	const masteredDates = index.lessonOrder.map((id) => L(id).masteredAt).filter((x): x is string => !!x).sort();
	const nthMastered = (n: number) => masteredDates[n - 1] ?? null;
	const hoursReachedAt = (h: number) => {
		let acc = 0;
		for (const d of Object.keys(byDate).sort()) {
			acc += byDate[d] ?? 0;
			if (acc >= h * 60) return d;
		}
		return null;
	};
	const firstPassed = Object.values(courses).map((c) => c.passedAt).filter((x): x is string => !!x).sort()[0] ?? null;
	const badges: Badge[] = [
		{ id: "first-step", title: "First Step", description: "Master your first lesson", earnedAt: nthMastered(1) },
		{ id: "ten-lessons", title: "Momentum", description: "Master 10 lessons", earnedAt: nthMastered(10) },
		{ id: "fifty-lessons", title: "Inertia", description: "Master 50 lessons", earnedAt: nthMastered(50) },
		{ id: "hundred-lessons", title: "Escape Velocity", description: "Master 100 lessons", earnedAt: nthMastered(100) },
		{ id: "week-streak", title: "Steady State", description: `4 weeks in a row with ${WEEKLY_LESSONS}+ lessons`, earnedAt: weeklyBest >= 4 ? today : null },
		{ id: "month-streak", title: "Limit Cycle", description: `12 weeks in a row with ${WEEKLY_LESSONS}+ lessons`, earnedAt: weeklyBest >= 12 ? today : null },
		{ id: "daily-chain", title: "Daily Habit", description: "7-day study chain", earnedAt: best >= 7 ? today : null },
		{ id: "ten-hours", title: "Ten Hours", description: "Study 10 hours", earnedAt: hoursReachedAt(10) },
		{ id: "hundred-hours", title: "Centurion", description: "Study 100 hours", earnedAt: hoursReachedAt(100) },
		{ id: "five-hundred-hours", title: "Adiabatic", description: "Study 500 hours", earnedAt: hoursReachedAt(500) },
		{ id: "perfect-ten", title: "Sharp Shooter", description: "10 perfect quick checks", earnedAt: perfectChecks >= 10 ? today : null },
		{ id: "reviewer", title: "Spaced Out", description: "Complete 25 reviews", earnedAt: reviewsDone >= 25 ? today : null },
		{ id: "first-course", title: "Course Complete", description: "Pass your first course final", earnedAt: firstPassed },
		...index.program.courseList.map((c) => ({
			id: `course-${c.id}`,
			title: `${c.code} Passed`,
			description: `Pass the ${c.title} final`,
			earnedAt: courses[c.id]!.passedAt,
		})),
	];

	return {
		now: nowIso,
		startDate,
		lessons,
		units,
		courses,
		assessments,
		subjects,
		study: { byDate, totalMinutes, thisWeekMinutes, weekTargetMinutes: hoursPerWeek * 60 },
		pace: {
			hoursPerWeekTarget: hoursPerWeek,
			recentHoursPerWeek,
			plannedHours,
			doneHours,
			remainingHours: plannedHours - doneHours,
			targetFinish,
			projectedFinish,
			slipWeeks: Math.round((Date.parse(projectedFinish) - Date.parse(targetFinish)) / (7 * DAY)),
		},
		plan,
		projection,
		parallel,
		next,
		reviewsDue,
		missedDue,
		xp: Math.round(xp),
		level: levelFor(xp),
		streak: { current, best },
		weekly,
		paused: pauses.find((p) => p.start <= today && today <= p.end) ?? null,
		projectsDone,
		badges,
	};
}
