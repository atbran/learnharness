/**
 * curriculum + progress — the spine validator and the pure progress
 * derivation (statuses, SM-2, schedule, streak, XP) over a tiny program.
 */
import assert from "node:assert";
import test from "node:test";
import { courseSchema, type Course, type Program, type ProgressEvent } from "../src/core/contracts/curriculum.ts";
import { indexProgram, lessonPrereqs, validateProgram } from "../src/core/curriculum.ts";
import { deriveProgress, levelFor, nextReview, initialReview, simulateSchedule } from "../src/core/progress.ts";

const lesson = (id: string, minutes = 60) => ({ id, title: id, minutes, objectives: ["Do a", "Do b"] });

function course(id: string, prereqs: string[], lessonIds: string[], hours = 10): Course {
	return courseSchema.parse({
		id,
		code: id.toUpperCase(),
		title: id,
		track: "math",
		depth: "core",
		hours,
		prereqs,
		subject: id === "b" ? "Physics" : "Math",
		summary: "s",
		units: [{ id: `${id}-u1`, title: "U1", summary: "s", lessons: lessonIds.map((l) => lesson(l)) }],
		exams: [{ id: `${id}-final`, kind: "final", title: "Final", covers: [`${id}-u1`], minutes: 120, passMark: 0.7 }],
	});
}

const program: Program = {
	id: "p",
	title: "P",
	summary: "s",
	targetWeeks: 4,
	hoursPerWeek: 10,
	courses: ["a", "b"],
	courseList: [course("a", [], ["a-1", "a-2"]), course("b", ["a"], ["b-1", "b-2"])],
};
const index = indexProgram(program);
const NOW = new Date("2026-11-10T12:00:00Z");
const at = (d: string) => `${d}T10:00:00.000Z`;

test("validator accepts a sound program and flags bad references", () => {
	const catalog = { books: [] };
	assert.deepEqual(
		validateProgram(program, catalog).filter((i) => i.level === "error"),
		[],
	);
	const broken: Program = { ...program, courseList: [course("a", ["zzz"], ["a-1"]), course("b", [], ["a-1"])] };
	const msgs = validateProgram(broken, catalog).map((i) => i.message).join("\n");
	assert.match(msgs, /unknown prereq course "zzz"/);
	assert.match(msgs, /duplicate id "a-1"/);
});

test("prereqs: previous lesson in course, and prerequisite course's last lesson", () => {
	assert.deepEqual(lessonPrereqs(index, "a-2"), ["a-1"]);
	assert.deepEqual(lessonPrereqs(index, "b-1"), ["a-2"]);
	assert.deepEqual(lessonPrereqs(index, "a-1"), []);
});

test("lesson statuses follow quick checks and placement", () => {
	const events: ProgressEvent[] = [
		{ type: "quick_check", at: at("2026-11-01"), lessonId: "a-1", score: 0.9 },
		{ type: "session_linked", at: at("2026-11-02"), lessonId: "a-2", chatId: "c1", mode: "teach" },
		{ type: "quick_check", at: at("2026-11-02"), lessonId: "a-2", score: 0.5 },
	];
	const snap = deriveProgress(index, events, { now: NOW });
	// Mastered 11-01 → first review due 11-04, i.e. due by NOW.
	assert.equal(snap.lessons["a-1"]!.status, "review-due");
	assert.equal(snap.lessons["a-2"]!.status, "in-progress");
	assert.equal(snap.lessons["b-1"]!.status, "locked");
	assert.deepEqual(snap.reviewsDue, ["a-1"]);

	const placed = deriveProgress(index, [{ type: "placement", at: at("2026-11-09"), lessonIds: ["a-1", "a-2"] }], { now: NOW });
	assert.equal(placed.lessons["a-2"]!.testedOut, true);
	assert.equal(placed.lessons["b-1"]!.status, "available");
	assert.equal(placed.courses["a"]!.fraction, 1);
});

test("course passes on its final; done hours credit the whole course", () => {
	const snap = deriveProgress(
		index,
		[{ type: "assessment_graded", at: at("2026-11-05"), assessmentId: "x", kind: "final", courseId: "a", unitIds: ["a-u1"], score: 0.75 }],
		{ now: NOW },
	);
	assert.equal(snap.courses["a"]!.status, "passed");
	assert.equal(snap.pace.doneHours, 10);
	assert.equal(snap.badges.find((b) => b.id === "first-course")!.earnedAt, at("2026-11-05"));
});

test("SM-2: good answers stretch the interval, a lapse resets it", () => {
	let r = initialReview("2026-11-01");
	assert.equal(r.due, "2026-11-04");
	r = nextReview(r, 5, "2026-11-04");
	assert.equal(r.intervalDays, 7);
	r = nextReview(r, 4, "2026-11-11");
	assert.equal(r.intervalDays, 16);
	const lapsed = nextReview(r, 1, "2026-11-27");
	assert.equal(lapsed.intervalDays, 1);
	assert.equal(lapsed.reps, 0);
	assert.ok(lapsed.ease >= 1.3);
});

test("schedule: dependent course waits; hours flow when one lane is idle", () => {
	const plan = simulateSchedule(index, { a: 10, b: 10 }, 10);
	assert.deepEqual(plan, [
		{ courseId: "a", startWeek: 0, endWeek: 1 },
		{ courseId: "b", startWeek: 1, endWeek: 2 },
	]);
});

test("coreqs: run alongside without blocking; unknown ones are flagged", () => {
	const paired: Program = {
		...program,
		courses: ["a", "c"],
		courseList: [course("a", [], ["a-1", "a-2"]), { ...course("c", [], ["c-1"]), coreqs: ["a"] }],
	};
	const pi = indexProgram(paired);
	assert.deepEqual(lessonPrereqs(pi, "c-1"), []);
	assert.deepEqual(simulateSchedule(pi, { a: 10, c: 10 }, 10), [
		{ courseId: "a", startWeek: 0, endWeek: 2 },
		{ courseId: "c", startWeek: 0, endWeek: 2 },
	]);
	// One course at a time: c waits for a's lane even with no prereq.
	assert.deepEqual(simulateSchedule(pi, { a: 10, c: 10 }, 10, 1), [
		{ courseId: "a", startWeek: 0, endWeek: 1 },
		{ courseId: "c", startWeek: 1, endWeek: 2 },
	]);
	const bad: Program = { ...paired, courseList: [paired.courseList[0]!, { ...paired.courseList[1]!, coreqs: ["zzz"] }] };
	assert.match(validateProgram(bad, { books: [] }).map((i) => i.message).join("\n"), /zzz/);
});

test("streak tolerates one missed day per week; XP and levels accrue", () => {
	const days = ["2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"];
	const events: ProgressEvent[] = days.map((d) => ({ type: "study_time", at: at(d), minutes: 30, source: "heartbeat" }));
	const snap = deriveProgress(index, events, { now: NOW });
	// 11-05 (Thu) is forgiven by the week's freeze → 7 qualifying days.
	assert.equal(snap.streak.current, 7);
	assert.equal(snap.study.totalMinutes, 210);
	assert.equal(snap.xp, 105);
	assert.deepEqual(levelFor(250), { level: 2, xpIntoLevel: 0, xpForLevel: 500 });
});

test("a short answer counted as correct by the learner masters the lesson but earns no XP twice", () => {
	const graded: ProgressEvent = { type: "quick_check", at: at("2026-11-01"), lessonId: "a-1", score: 2.3 / 3, missed: [2] };
	const before = deriveProgress(index, [graded], { now: NOW });
	const after = deriveProgress(index, [graded, { type: "quick_check", at: "2026-11-01T10:05:00.000Z", lessonId: "a-1", score: 1, missed: [], overridden: [2] }], { now: NOW });
	assert.equal(before.lessons["a-1"]!.masteredAt, null);
	assert.equal(after.lessons["a-1"]!.masteredAt, "2026-11-01T10:05:00.000Z");
	assert.deepEqual(after.lessons["a-1"]!.missed, []);
	assert.equal(after.xp - before.xp, 100); // the lesson's mastery, nothing for the re-score
});
