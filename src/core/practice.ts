/**
 * Practice selection (pure): which lessons a printable practice sheet
 * draws from — what the learner is on or just finished, weighted toward
 * weak spots, interleaved across courses — and what fits a study break.
 */

import type { ProgramIndex } from "./curriculum.ts";
import { isoDate, type ProgressSnapshot } from "./progress.ts";

const RECENT_DAYS = 14;
const SHEET_LESSONS = 5;

export function pickWorksheetLessons(
	index: ProgramIndex,
	snapshot: Pick<ProgressSnapshot, "now" | "lessons">,
	opts: { unitId?: string; weak?: ReadonlySet<string> } = {},
): string[] {
	const since = isoDate(new Date(Date.parse(snapshot.now) - RECENT_DAYS * 86_400_000));
	const pool = opts.unitId ? (index.units.get(opts.unitId)?.unit.lessons.map((l) => l.id) ?? []) : index.lessonOrder;
	const scored = pool
		.map((id) => {
			const l = snapshot.lessons[id];
			if (!l) return null;
			const recent = l.masteredAt !== null && isoDate(l.masteredAt) >= since;
			const touched = l.status === "in-progress" || recent || l.missed.length > 0 || l.diagnostic !== null;
			if (!touched && !(opts.unitId && l.masteredAt)) return null;
			const score =
				(l.missed.length ? 3 : 0) +
				(l.bestCheck !== null && l.bestCheck < 0.8 ? 2 : 0) +
				(opts.weak?.has(id) ? 2 : 0) +
				(l.diagnostic ? 1 : 0) +
				(l.status === "in-progress" ? 1 : 0);
			return { id, score };
		})
		.filter((x): x is { id: string; score: number } => x !== null)
		.sort((a, b) => b.score - a.score || index.lessonOrder.indexOf(a.id) - index.lessonOrder.indexOf(b.id));
	if (scored.length === 0 && opts.unitId) return pool.slice(0, 3);
	// Interleave courses: the best lesson of each course, then the next.
	const byCourse = new Map<string, string[]>();
	for (const { id } of scored) {
		const c = index.lessons.get(id)!.course.id;
		byCourse.set(c, [...(byCourse.get(c) ?? []), id]);
	}
	const queues = [...byCourse.values()];
	const out: string[] = [];
	for (let i = 0; out.length < SHEET_LESSONS && queues.some((q) => q.length > i); i++)
		for (const q of queues) {
			const id = q[i];
			if (id && out.length < SHEET_LESSONS) out.push(id);
		}
	return out;
}

// ─── Break planner ──────────────────────────────────────────────────────────

/** One lesson as the planner needs it (the program view's lesson shape). */
export interface PlanLesson {
	id: string;
	title: string;
	minutes: number;
	courseId: string;
	unitId: string;
}

export type BreakItem =
	| { kind: "missed"; minutes: number; lessons: string[]; questions: number }
	| { kind: "review"; minutes: number; lessons: string[] }
	| { kind: "lesson"; minutes: number; lessonId: string; fastTrack: boolean; partial: boolean }
	| { kind: "quiz"; minutes: number; lessonId: string }
	| { kind: "drill"; minutes: number; unitId: string };

const MISSED_PER_QUESTION = 1.5;
const MISSED_CAP = 5;
const REVIEW_PER_LESSON = 3;
const MIN_LESSON_START = 10;
const MIN_LEFTOVER = 5;
const QUIZ_MINUTES = 8;

/** Fast track takes about 40% of a lesson's time, at least 10 minutes. */
export function fastTrackMinutes(minutes: number): number {
	return Math.max(MIN_LESSON_START, Math.round(minutes * 0.4));
}

/** A plan that fits a study break: missed questions, then due reviews (a
 *  quarter of the time at most), then the next lesson (fast-track when its
 *  course/unit is in review mode or a diagnostic sent it there; started
 *  only, when it can't finish), then a quiz or drill in what's left. */
export function planBreak(
	breakMinutes: number,
	lessons: readonly PlanLesson[],
	snapshot: Pick<ProgressSnapshot, "lessons" | "next" | "reviewsDue" | "missedDue">,
	reviewMode: readonly string[],
): BreakItem[] {
	const byId = new Map(lessons.map((l) => [l.id, l]));
	const items: BreakItem[] = [];
	let left = breakMinutes;

	const missedLessons: string[] = [];
	let questions = 0;
	for (const id of snapshot.missedDue) {
		const n = snapshot.lessons[id]?.missed.length ?? 0;
		if (missedLessons.length && (questions + n) * MISSED_PER_QUESTION > MISSED_CAP) break;
		missedLessons.push(id);
		questions += n;
	}
	if (missedLessons.length) {
		const minutes = Math.min(MISSED_CAP, Math.max(1, Math.round(questions * MISSED_PER_QUESTION)));
		items.push({ kind: "missed", minutes, lessons: missedLessons, questions });
		left -= minutes;
	}

	const reviewSlots = Math.floor(breakMinutes / 4 / REVIEW_PER_LESSON);
	const reviews = snapshot.reviewsDue.filter((id) => !missedLessons.includes(id)).slice(0, reviewSlots);
	if (reviews.length) {
		items.push({ kind: "review", minutes: reviews.length * REVIEW_PER_LESSON, lessons: reviews });
		left -= reviews.length * REVIEW_PER_LESSON;
	}

	const nextId = snapshot.next.find((id) => byId.has(id) && !snapshot.lessons[id]?.masteredAt);
	const next = nextId ? byId.get(nextId) : undefined;
	if (next && left >= MIN_LESSON_START) {
		const lp = snapshot.lessons[next.id];
		const fastTrack = reviewMode.includes(next.courseId) || reviewMode.includes(next.unitId) || (lp?.diagnostic?.missed.length ?? 0) > 0;
		const need = fastTrack ? fastTrackMinutes(next.minutes) : next.minutes;
		const minutes = Math.min(need, left);
		items.push({ kind: "lesson", minutes, lessonId: next.id, fastTrack, partial: need > left });
		left -= minutes;
	}

	if (left >= MIN_LEFTOVER) {
		const planned = new Set(items.flatMap((i) => (i.kind === "lesson" ? [i.lessonId] : [])));
		const quiz = lessons.find((l) => {
			const lp = snapshot.lessons[l.id];
			return lp && lp.started && !lp.masteredAt && !planned.has(l.id);
		});
		if (quiz) items.push({ kind: "quiz", minutes: Math.min(QUIZ_MINUTES, left), lessonId: quiz.id });
		else if (next) items.push({ kind: "drill", minutes: left, unitId: next.unitId });
	}
	return items;
}
