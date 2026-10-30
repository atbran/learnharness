/**
 * Pure assessment logic: deterministic grading of quick-check mc/numeric
 * questions, score aggregation, placement test-outs, review quality.
 */

import type { Assessment, CheckQuestion, ProblemGrade } from "./contracts/curriculum.ts";

/** Parse a learner's numeric answer: "3.2e-5", "3.2 × 10^-5", "1,200", "−4". */
export function parseNumber(raw: string): number | null {
	const s = raw
		.trim()
		.replace(/[−–]/g, "-")
		.replace(/,(?=\d{3}\b)/g, "")
		.replace(/\s*(?:×|x|\*)\s*10\s*\^\s*\{?\s*(-?\d+)\s*\}?/i, "e$1")
		.replace(/\s+/g, "");
	const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(s);
	return m ? Number(m[0]) : null;
}

/** Relative tolerance check (absolute when the answer is 0). */
export function numericMatches(given: number, answer: number, tolerance: number): boolean {
	const tol = tolerance > 0 ? tolerance : 0.02;
	if (answer === 0) return Math.abs(given) <= tol;
	return Math.abs(given - answer) <= Math.abs(answer) * tol;
}

/** Grade one deterministic question; null for short answers (model-graded). */
export function gradeDeterministic(q: CheckQuestion, response: string): { correct: boolean; feedback: string } | null {
	if (q.kind === "mc") {
		const chosen = Number(response);
		const correct = chosen === q.answer;
		return { correct, feedback: correct ? q.explanation : `Answer: ${q.options[q.answer] ?? "?"}. ${q.explanation}` };
	}
	if (q.kind === "numeric") {
		const n = parseNumber(response);
		const correct = n !== null && numericMatches(n, q.answer, q.tolerance);
		return {
			correct,
			feedback: correct ? q.explanation : `${n === null ? "Not a number. " : ""}Expected ≈ ${q.answer}${q.unit ? ` ${q.unit}` : ""}. ${q.explanation}`,
		};
	}
	return null;
}

export function totalScore(grades: readonly ProblemGrade[]): number {
	const max = grades.reduce((s, g) => s + g.max, 0);
	return max > 0 ? grades.reduce((s, g) => s + Math.max(0, Math.min(g.points, g.max)), 0) / max : 0;
}

/** Per-unit score of a graded assessment. */
export function unitScores(a: Pick<Assessment, "problems">, grades: readonly ProblemGrade[]): Record<string, number> {
	const by = new Map(grades.map((g) => [g.problemId, g]));
	const acc: Record<string, { got: number; max: number }> = {};
	for (const p of a.problems) {
		const g = by.get(p.id);
		const slot = (acc[p.unitId] ??= { got: 0, max: 0 });
		slot.max += g?.max ?? p.points;
		slot.got += Math.max(0, Math.min(g?.points ?? 0, g?.max ?? p.points));
	}
	return Object.fromEntries(Object.entries(acc).map(([u, v]) => [u, v.max ? v.got / v.max : 0]));
}

/** Lessons a placement test lets the learner skip: every lesson of every
 *  unit whose problems scored at or above the pass mark. */
export function placementTestOuts(
	a: Pick<Assessment, "problems" | "passMark">,
	grades: readonly ProblemGrade[],
	unitLessons: (unitId: string) => string[],
): string[] {
	const scores = unitScores(a, grades);
	return Object.entries(scores)
		.filter(([, s]) => s >= a.passMark)
		.flatMap(([u]) => unitLessons(u));
}

/** Review quality (SM-2, 0..5) from a review-quiz score 0..1. */
export function reviewQuality(score: number): number {
	return Math.max(0, Math.min(5, Math.round(score * 5)));
}
