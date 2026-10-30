/**
 * Practice selection (pure): which lessons a printable practice sheet
 * draws from — what the learner is on or just finished, weighted toward
 * weak spots, interleaved across courses.
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
