/**
 * assessments — deterministic quick-check grading, score aggregation, and
 * placement test-outs.
 */
import assert from "node:assert";
import test from "node:test";
import { gradeDeterministic, numericMatches, parseNumber, placementTestOuts, reviewQuality, totalScore, unitScores } from "../src/core/assessments.ts";

test("parseNumber reads the ways people type numbers", () => {
	assert.equal(parseNumber("3.2e-5"), 3.2e-5);
	assert.equal(parseNumber("3.2 × 10^-5"), 3.2e-5);
	assert.equal(parseNumber("3.2x10^{-5} m"), 3.2e-5);
	assert.equal(parseNumber("1,200 J"), 1200);
	assert.equal(parseNumber("−4"), -4);
	assert.equal(parseNumber("about five"), null);
});

test("numeric tolerance is relative (absolute at zero)", () => {
	assert.ok(numericMatches(9.9, 10, 0.02));
	assert.ok(!numericMatches(9.7, 10, 0.02));
	assert.ok(numericMatches(0.001, 0, 0.02));
});

test("mc and numeric grade deterministically; short answers defer", () => {
	assert.equal(gradeDeterministic({ kind: "mc", prompt: "", options: ["a", "b"], answer: 1, explanation: "" }, "1")!.correct, true);
	assert.equal(gradeDeterministic({ kind: "mc", prompt: "", options: ["a", "b"], answer: 1, explanation: "" }, "0")!.correct, false);
	assert.equal(gradeDeterministic({ kind: "numeric", prompt: "", answer: 6.67e-11, tolerance: 0.02, explanation: "" }, "6.7e-11")!.correct, true);
	assert.equal(gradeDeterministic({ kind: "short", prompt: "", rubric: "", modelAnswer: "" }, "x"), null);
});

test("scores, unit scores, and placement test-outs", () => {
	const a = {
		passMark: 0.8,
		problems: [
			{ id: "p1", unitId: "u1", points: 5 },
			{ id: "p2", unitId: "u1", points: 5 },
			{ id: "p3", unitId: "u2", points: 10 },
		] as never,
	};
	const grades = [
		{ problemId: "p1", points: 5, max: 5, feedback: "" },
		{ problemId: "p2", points: 4, max: 5, feedback: "" },
		{ problemId: "p3", points: 12, max: 10, feedback: "" },
	];
	assert.equal(totalScore(grades), 19 / 20);
	assert.deepEqual(unitScores(a, grades), { u1: 0.9, u2: 1 });
	assert.deepEqual(placementTestOuts(a, grades.slice(0, 2), (u) => [`${u}-l1`, `${u}-l2`]), ["u1-l1", "u1-l2"]);
	assert.equal(reviewQuality(0.62), 3);
});
