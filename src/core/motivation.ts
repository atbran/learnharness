/**
 * Motivation (pure): declared pauses, the weekly review's numbers, and
 * "then and now" — a quiz question missed weeks ago, offered again once
 * its lesson is mastered, so the learner sees how far they've come.
 */

import type { ProgressEvent } from "./contracts/curriculum.ts";
import { addDays, isoDate, weekStart, WEEKLY_LESSONS, type Pause, type ProgressSnapshot } from "./progress.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Well-formed pauses only (start ≤ end, short reasons). */
export function sanitizePauses(raw: unknown): Pause[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((p) => {
		if (!p || typeof p !== "object") return [];
		const { start, end, reason } = p as Record<string, unknown>;
		if (typeof start !== "string" || typeof end !== "string" || !DATE.test(start) || !DATE.test(end) || start > end) return [];
		return [{ start, end, ...(typeof reason === "string" && reason.trim() ? { reason: reason.trim().slice(0, 120) } : {}) }];
	});
}

export interface WeekSummary {
	weekStart: string;
	weekEnd: string;
	/** Lessons finished (quiz-mastered or tested out) and how many of those were test-outs. */
	finished: number;
	testedOut: number;
	met: boolean;
	minutes: number;
	quizzes: number;
	reviews: number;
	/** "ever" when no earlier week had as many lessons; else the latest such week; null when none finished. */
	bestSince: "ever" | string | null;
}

/** The numbers for one Monday-week (the weekly review card). */
export function weekSummary(snapshot: Pick<ProgressSnapshot, "lessons" | "startDate">, events: readonly ProgressEvent[], week: string): WeekSummary {
	const end = addDays(week, 7);
	const inWeek = (at: string) => {
		const d = isoDate(at);
		return d >= week && d < end;
	};
	const byWeek = new Map<string, number>();
	let finished = 0;
	let testedOut = 0;
	for (const l of Object.values(snapshot.lessons)) {
		if (!l.masteredAt) continue;
		const wk = weekStart(isoDate(l.masteredAt));
		byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
		if (wk === week) {
			finished++;
			if (l.testedOut) testedOut++;
		}
	}
	let minutes = 0;
	let quizzes = 0;
	let reviews = 0;
	for (const ev of events) {
		if (!inWeek(ev.at)) continue;
		if (ev.type === "study_time") minutes += ev.minutes;
		else if (ev.type === "quick_check") quizzes++;
		else if (ev.type === "review_done" || ev.type === "missed_retake" || ev.type === "then_now") reviews++;
	}
	let bestSince: WeekSummary["bestSince"] = null;
	if (finished > 0) {
		bestSince = "ever";
		const first = weekStart(snapshot.startDate);
		for (let w = addDays(week, -7); w >= first; w = addDays(w, -7))
			if ((byWeek.get(w) ?? 0) >= finished) {
				bestSince = w;
				break;
			}
	}
	return { weekStart: week, weekEnd: addDays(week, 6), finished, testedOut, met: finished >= WEEKLY_LESSONS, minutes, quizzes, reviews, bestSince };
}

/** The motivation extras the program home shows: last week's and this
 *  week's numbers (the weekly review) and a "then and now" question. */
export interface MotivationView {
	lastWeek: WeekSummary;
	thisWeek: WeekSummary;
	thenNow: { lessonId: string; lessonTitle: string; question: number; missedAt: string } | null;
}

export const THEN_NOW_AFTER_DAYS = 14;

/** A question missed at least two weeks ago in a lesson now mastered, never
 *  offered before — at most one every two weeks. The oldest miss first. */
export function thenNowCandidate(
	events: readonly ProgressEvent[],
	snapshot: Pick<ProgressSnapshot, "lessons">,
	today: string,
): { lessonId: string; question: number; missedAt: string } | null {
	const cutoff = addDays(today, -THEN_NOW_AFTER_DAYS);
	const used = new Set<string>();
	let lastOffer: string | null = null;
	for (const ev of events)
		if (ev.type === "then_now") {
			used.add(`${ev.lessonId}#${ev.question}`);
			if (!lastOffer || ev.at > lastOffer) lastOffer = ev.at;
		}
	if (lastOffer && isoDate(lastOffer) > cutoff) return null;
	const misses = events
		.filter((ev): ev is Extract<ProgressEvent, { type: "quick_check" }> => ev.type === "quick_check" && !!ev.missed?.length && isoDate(ev.at) <= cutoff)
		.sort((a, b) => a.at.localeCompare(b.at));
	for (const ev of misses) {
		if (!snapshot.lessons[ev.lessonId]?.masteredAt) continue;
		const q = ev.missed!.find((i) => !used.has(`${ev.lessonId}#${i}`));
		if (q !== undefined) return { lessonId: ev.lessonId, question: q, missedAt: ev.at };
	}
	return null;
}
