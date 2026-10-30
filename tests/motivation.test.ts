/**
 * Motivation over a tiny program: the weekly lesson streak (test-outs
 * count, paused weeks skipped), the 15-minute daily chain across a pause,
 * pace windows pushed out by a pause, the weekly review's numbers, and the
 * "then and now" pick.
 */
import assert from "node:assert";
import test from "node:test";
import { courseSchema, type Course, type Program, type ProgressEvent } from "../src/core/contracts/curriculum.ts";
import { indexProgram } from "../src/core/curriculum.ts";
import { deriveProgress } from "../src/core/progress.ts";
import { sanitizePauses, thenNowCandidate, weekSummary } from "../src/core/motivation.ts";

const ids = Array.from({ length: 12 }, (_, i) => `a-${i + 1}`);
function course(): Course {
	return courseSchema.parse({
		id: "a",
		code: "A",
		title: "a",
		track: "math",
		depth: "core",
		hours: 10,
		prereqs: [],
		subject: "Math",
		summary: "s",
		units: [{ id: "a-u1", title: "U1", summary: "s", lessons: ids.map((id) => ({ id, title: id, minutes: 30, objectives: ["x", "y"] })) }],
		exams: [],
	});
}
const program: Program = { id: "p", title: "P", summary: "s", targetWeeks: 4, hoursPerWeek: 10, courses: ["a"], courseList: [course()] };
const index = indexProgram(program);
const at = (d: string) => `${d}T12:00:00.000Z`;
const pass = (id: string, d: string): ProgressEvent => ({ type: "quick_check", at: at(d), lessonId: id, score: 1 });
// Mondays: 2026-11-02, 11-09, 11-16, 11-23.

test("weekly streak: weeks with 3+ finished lessons in a row; test-outs count; this week joins at 3", () => {
	const events: ProgressEvent[] = [
		{ type: "study_time", at: at("2026-11-02"), minutes: 5, source: "manual" },
		pass("a-1", "2026-11-03"), pass("a-2", "2026-11-04"), pass("a-3", "2026-11-06"),
		{ type: "placement", at: at("2026-11-10"), lessonIds: ["a-4", "a-5", "a-6"] },
		pass("a-7", "2026-11-17"), pass("a-8", "2026-11-18"),
	];
	const midWeek = deriveProgress(index, events, { now: new Date(at("2026-11-18")) });
	assert.equal(midWeek.weekly.current, 2); // two full weeks; this week at 2/3
	assert.deepEqual(midWeek.weekly.thisWeek, { weekStart: "2026-11-16", finished: 2, target: 3 });
	const third = deriveProgress(index, [...events, pass("a-9", "2026-11-19")], { now: new Date(at("2026-11-19")) });
	assert.equal(third.weekly.current, 3);
	// A week with only 2 breaks it.
	const broken = deriveProgress(index, events.filter((e) => !(e.type === "placement")), { now: new Date(at("2026-11-18")) });
	assert.equal(broken.weekly.current, 0);
	assert.equal(broken.weekly.best, 1);
});

test("a paused week neither counts nor breaks the weekly streak", () => {
	const events: ProgressEvent[] = [
		{ type: "study_time", at: at("2026-11-02"), minutes: 5, source: "manual" },
		pass("a-1", "2026-11-03"), pass("a-2", "2026-11-04"), pass("a-3", "2026-11-05"),
		pass("a-4", "2026-11-17"), pass("a-5", "2026-11-18"), pass("a-6", "2026-11-19"),
	];
	const pauses = [{ start: "2026-11-09", end: "2026-11-14" }];
	assert.equal(deriveProgress(index, events, { now: new Date(at("2026-11-20")) }).weekly.current, 1);
	const snap = deriveProgress(index, events, { now: new Date(at("2026-11-20")), pauses });
	assert.equal(snap.weekly.current, 2);
	assert.equal(deriveProgress(index, events, { now: new Date(at("2026-11-11")), pauses }).paused?.end, "2026-11-14");
});

test("daily chain: 15 minutes counts, and paused days don't break it", () => {
	const day = (d: string, minutes: number): ProgressEvent => ({ type: "study_time", at: at(d), minutes, source: "manual" });
	const events = [day("2026-11-02", 15), day("2026-11-03", 15), day("2026-11-07", 15), day("2026-11-08", 15)];
	const now = new Date(at("2026-11-08"));
	assert.equal(deriveProgress(index, events, { now }).streak.current, 2);
	assert.equal(deriveProgress(index, events, { now, pauses: [{ start: "2026-11-04", end: "2026-11-06" }] }).streak.current, 4);
});

test("a pause inside a unit's target window pushes its end out", () => {
	const events: ProgressEvent[] = [{ type: "lesson_started", at: at("2026-11-02"), lessonId: "a-1" }, { type: "session_linked", at: at("2026-11-02"), lessonId: "a-1", chatId: "c", mode: "teach" }];
	const opts = { now: new Date(at("2026-11-04")), unitWeeks: { "a-u1": 2 } };
	assert.equal(deriveProgress(index, events, opts).units["a-u1"]!.pace!.targetEnd, "2026-11-16");
	assert.equal(deriveProgress(index, events, { ...opts, pauses: [{ start: "2026-11-05", end: "2026-11-07" }] }).units["a-u1"]!.pace!.targetEnd, "2026-11-19");
});

test("weekly review numbers and 'best since'", () => {
	const events: ProgressEvent[] = [
		{ type: "study_time", at: at("2026-11-02"), minutes: 30, source: "heartbeat" },
		pass("a-1", "2026-11-03"), pass("a-2", "2026-11-04"),
		{ type: "study_time", at: at("2026-11-10"), minutes: 45, source: "heartbeat" },
		pass("a-3", "2026-11-10"),
		{ type: "placement", at: at("2026-11-11"), lessonIds: ["a-4", "a-5"] },
		{ type: "review_done", at: at("2026-11-12"), lessonId: "a-1", quality: 5 },
	];
	const snap = deriveProgress(index, events, { now: new Date(at("2026-11-16")) });
	assert.deepEqual(weekSummary(snap, events, "2026-11-09"), {
		weekStart: "2026-11-09",
		weekEnd: "2026-11-15",
		finished: 3,
		testedOut: 2,
		met: true,
		minutes: 45,
		quizzes: 1,
		reviews: 1,
		bestSince: "ever",
	});
	assert.equal(weekSummary(snap, events, "2026-11-02").bestSince, "ever");
	assert.equal(weekSummary(snap, events, "2026-11-16").bestSince, null);
});

test("then and now: a miss from 2+ weeks ago in a now-mastered lesson, once, every two weeks", () => {
	const events: ProgressEvent[] = [
		{ type: "quick_check", at: at("2026-11-02"), lessonId: "a-1", score: 0.6, missed: [2, 4] },
		pass("a-1", "2026-11-05"),
		{ type: "quick_check", at: at("2026-11-03"), lessonId: "a-2", score: 0.4, missed: [1] }, // never mastered
	];
	const snap = (evs: ProgressEvent[], d: string) => deriveProgress(index, evs, { now: new Date(at(d)) });
	assert.equal(thenNowCandidate(events, snap(events, "2026-11-10"), "2026-11-10"), null); // too recent
	assert.deepEqual(thenNowCandidate(events, snap(events, "2026-11-17"), "2026-11-17"), { lessonId: "a-1", question: 2, missedAt: at("2026-11-02") });
	const tried = [...events, { type: "then_now", at: at("2026-11-17"), lessonId: "a-1", question: 2, correct: true } as ProgressEvent];
	assert.equal(thenNowCandidate(tried, snap(tried, "2026-11-20"), "2026-11-20"), null); // one every two weeks
	assert.deepEqual(thenNowCandidate(tried, snap(tried, "2026-12-01"), "2026-12-01")?.question, 4);
	// Wrong again: back into the missed review.
	const wrong = [...events, { type: "then_now", at: at("2026-11-17"), lessonId: "a-1", question: 2, correct: false } as ProgressEvent];
	assert.ok(snap(wrong, "2026-11-18").missedDue.includes("a-1"));
});

test("pauses are sanitized", () => {
	assert.deepEqual(sanitizePauses([{ start: "2026-11-01", end: "2026-11-03", reason: " trip " }, { start: "2026-11-05", end: "2026-11-04" }, "x"]), [
		{ start: "2026-11-01", end: "2026-11-03", reason: "trip" },
	]);
});
