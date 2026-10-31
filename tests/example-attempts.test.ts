/**
 * example attempts — the learner's report per worked example (latest save
 * wins) and which reports go to the tutor as trouble.
 */
import assert from "node:assert";
import test from "node:test";
import type { ProgressEvent } from "../src/core/contracts/curriculum.ts";
import { latestExampleAttempts, troubleAttempts } from "../src/core/example-attempts.ts";

const ev = (at: string, example: number, rest: { confidence?: number; result?: "got" | "partly" | "missed"; stuck?: string } = {}, lessonId = "l1"): ProgressEvent => ({
	type: "example_attempt",
	at: `2026-10-31T${at}:00.000Z`,
	lessonId,
	example,
	...rest,
});

test("the latest save per example wins, whatever the ledger order; other lessons are ignored", () => {
	const a = latestExampleAttempts([ev("10:02", 0, { result: "got", confidence: 5 }), ev("10:01", 0, { result: "missed" }), ev("10:00", 1, { confidence: 2 }), ev("10:03", 0, {}, "l2")], "l1");
	assert.deepStrictEqual([a[0]!.result, a[0]!.confidence, a[1]!.confidence], ["got", 5, 2]);
	assert.strictEqual(Object.keys(a).length, 2);
});

test("trouble: missed or partly, confidence 3 or less, or a stuck note; a confident Got it is not", () => {
	const a = latestExampleAttempts(
		[ev("10:00", 0, { result: "got", confidence: 4 }), ev("10:00", 1, { result: "partly" }), ev("10:00", 2, { confidence: 3 }), ev("10:00", 3, { result: "got", stuck: "the sign of the exponent" }), ev("10:00", 4, { result: "missed" })],
		"l1",
	);
	assert.deepStrictEqual(troubleAttempts(a).map((x) => x.example), [1, 2, 3, 4]);
});
