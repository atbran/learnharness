/**
 * Worked-example attempts (pure): the learner's own report on trying each
 * example — confidence, how it went, where they got stuck — replayed from the
 * ledger's example_attempt events, latest save per example.
 */

import type { ProgressEvent } from "./contracts/curriculum.ts";

export type AttemptResult = "got" | "partly" | "missed";

export interface ExampleAttempt {
	example: number;
	confidence?: number;
	result?: AttemptResult;
	stuck?: string;
	at: string;
}

/** The latest report per example of one lesson, by example index. */
export function latestExampleAttempts(events: readonly ProgressEvent[], lessonId: string): Record<number, ExampleAttempt> {
	const out: Record<number, ExampleAttempt> = {};
	for (const ev of events) {
		if (ev.type !== "example_attempt" || ev.lessonId !== lessonId) continue;
		if (out[ev.example] && out[ev.example]!.at > ev.at) continue;
		out[ev.example] = { example: ev.example, confidence: ev.confidence, result: ev.result, stuck: ev.stuck, at: ev.at };
	}
	return out;
}

/** Reports that say the learner needs help: missed or partly, confidence
 *  of 3 or less, or a stuck note. */
export function troubleAttempts(attempts: Record<number, ExampleAttempt>): ExampleAttempt[] {
	return Object.values(attempts)
		.filter((a) => a.result === "missed" || a.result === "partly" || (a.confidence !== undefined && a.confidence <= 3) || !!a.stuck?.trim())
		.sort((a, b) => a.example - b.example);
}
