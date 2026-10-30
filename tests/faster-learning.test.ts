/**
 * Faster-learning features over a tiny program: diagnostic outcomes and
 * missed questions in progress, unit pace targets and fixed-length lanes,
 * interleaved "next up", practice-sheet lesson picks, transcript parsing,
 * and the fast-track notes split.
 */
import assert from "node:assert";
import test from "node:test";
import { courseSchema, type Course, type Program, type ProgressEvent } from "../src/core/contracts/curriculum.ts";
import { indexProgram } from "../src/core/curriculum.ts";
import { deriveProgress, simulateSchedule } from "../src/core/progress.ts";
import { pickWorksheetLessons } from "../src/core/practice.ts";
import { clipTranscript, parseTranscript } from "../src/core/transcripts.ts";
import { fastTrackNotes, notesSections } from "../lib/notes-sections.ts";

const lesson = (id: string, minutes = 60) => ({ id, title: id, minutes, objectives: ["Do a", "Do b"] });

function course(id: string, units: Record<string, string[]>, hours = 10): Course {
	return courseSchema.parse({
		id,
		code: id.toUpperCase(),
		title: id,
		track: "math",
		depth: "core",
		hours,
		prereqs: [],
		subject: "Math",
		summary: "s",
		units: Object.entries(units).map(([uid, ls]) => ({ id: uid, title: uid, summary: "s", lessons: ls.map((l) => lesson(l)) })),
		exams: [],
	});
}

const program: Program = {
	id: "p",
	title: "P",
	summary: "s",
	targetWeeks: 4,
	hoursPerWeek: 10,
	courses: ["a", "b"],
	courseList: [course("a", { "a-u1": ["a-1", "a-2"], "a-u2": ["a-3", "a-4"] }), course("b", { "b-u1": ["b-1", "b-2", "b-3"] })],
};
const index = indexProgram(program);
const NOW = new Date("2026-11-10T12:00:00Z");
const at = (d: string) => `${d}T10:00:00.000Z`;

test("diagnostic: 1/2 goes fast-track with what was missed; a full miss only marks the unit", () => {
	const events: ProgressEvent[] = [
		{ type: "placement", at: at("2026-11-09"), lessonIds: ["a-1"] },
		{ type: "diagnostic", at: at("2026-11-09"), unitId: "a-u1", lessonId: "a-2", missed: [{ prompt: "Q?", explanation: "Because." }] },
	];
	const snap = deriveProgress(index, events, { now: NOW });
	assert.equal(snap.lessons["a-1"]!.testedOut, true);
	assert.deepEqual(snap.lessons["a-2"]!.diagnostic?.missed, [{ prompt: "Q?", explanation: "Because." }]);
	assert.equal(snap.lessons["a-2"]!.status, "in-progress");
	assert.equal(snap.units["a-u1"]!.diagnosedAt, at("2026-11-09"));

	const miss = deriveProgress(index, [{ type: "diagnostic", at: at("2026-11-09"), unitId: "a-u1", lessonId: "a-1", missed: [] }], { now: NOW });
	assert.equal(miss.lessons["a-1"]!.diagnostic, null);
	assert.equal(miss.lessons["a-1"]!.status, "available");
	assert.equal(miss.units["a-u1"]!.diagnosedAt, at("2026-11-09"));
});

test("missed quiz questions come back the next day and clear on a retake", () => {
	const missed: ProgressEvent = { type: "quick_check", at: at("2026-11-09"), lessonId: "a-1", score: 0.6, missed: [1, 3] };
	assert.deepEqual(deriveProgress(index, [missed], { now: NOW }).missedDue, ["a-1"]);
	assert.deepEqual(deriveProgress(index, [missed], { now: new Date("2026-11-09T20:00:00Z") }).missedDue, []);
	const cleared = deriveProgress(index, [missed, { type: "missed_retake", at: at("2026-11-10"), lessonId: "a-1", missed: [] }], { now: NOW });
	assert.deepEqual(cleared.missedDue, []);
	assert.deepEqual(cleared.lessons["a-1"]!.missed, []);
});

test("unit pace: units laid end to end from first activity; per-day and ahead/behind", () => {
	const events: ProgressEvent[] = [
		{ type: "lesson_started", at: at("2026-11-01"), lessonId: "a-1" },
		{ type: "session_linked", at: at("2026-11-01"), lessonId: "a-1", chatId: "c", mode: "teach" },
	];
	const snap = deriveProgress(index, events, { now: NOW, unitWeeks: { "a-u1": 1, "a-u2": 2 } });
	const u1 = snap.units["a-u1"]!.pace!;
	assert.equal(u1.targetStart, "2026-11-01");
	assert.equal(u1.targetEnd, "2026-11-08");
	assert.equal(u1.status, "behind"); // window over, nothing mastered
	assert.equal(u1.lessonsLeft, 2);
	const u2 = snap.units["a-u2"]!.pace!;
	assert.equal(u2.targetStart, "2026-11-08");
	assert.equal(u2.targetEnd, "2026-11-22");
	assert.equal(u2.perDayNeeded, 2 / 12);
	assert.equal(snap.units["b-u1"]!.pace, null); // no targets in course b
});

test("schedule: a fully targeted course runs a fixed lane without drawing hours", () => {
	assert.deepEqual(simulateSchedule(index, { a: 10, b: 10 }, 10, 3, 1500, { a: 3 }), [
		{ courseId: "a", startWeek: 0, endWeek: 3 },
		{ courseId: "b", startWeek: 0, endWeek: 1 },
	]);
});

test("next up interleaves the active courses", () => {
	const snap = deriveProgress(index, [], { now: NOW });
	assert.deepEqual(snap.next.slice(0, 2).map((id) => id[0]), ["a", "b"]);
});

test("practice sheet: recent and weak lessons, interleaved across courses", () => {
	const events: ProgressEvent[] = [
		{ type: "quick_check", at: at("2026-11-08"), lessonId: "a-1", score: 0.9 },
		{ type: "quick_check", at: at("2026-11-08"), lessonId: "a-2", score: 0.5, missed: [0, 2] },
		{ type: "lesson_started", at: at("2026-11-09"), lessonId: "b-1" },
	];
	const snap = deriveProgress(index, events, { now: NOW });
	assert.deepEqual(pickWorksheetLessons(index, snap), ["a-2", "b-1", "a-1"]);
	assert.deepEqual(pickWorksheetLessons(index, snap, { unitId: "b-u1" }), ["b-1"]);
	assert.deepEqual(pickWorksheetLessons(index, deriveProgress(index, [], { now: NOW }), { unitId: "a-u2" }), ["a-3", "a-4"]);
});

test("transcripts: parse [m:ss] / [h:mm:ss] lines and trim to a clip", () => {
	const lines = parseTranscript("[0:00] intro\n[0:30] thirty\nnoise\n[1:05] sixty-five\n[1:02:03] late\n");
	assert.deepEqual(lines.map((l) => l.t), [0, 30, 65, 3723]);
	// The line running at the clip start is kept; the end is exclusive.
	assert.deepEqual(clipTranscript(lines, 40, 3723).map((l) => l.text), ["thirty", "sixty-five"]);
	assert.deepEqual(clipTranscript(lines, 30).map((l) => l.text), ["thirty", "sixty-five", "late"]);
});

test("fast-track notes keep the big idea, the math and common mistakes", () => {
	const md = "intro\n## The big idea — x\nBig.\n## Building intuition\nSkip.\n## The math\n$$a$$\n## Common mistakes\n- one\n## Read more\nbooks";
	assert.deepEqual(notesSections(md).map((s) => s.heading), ["The big idea — x", "Building intuition", "The math", "Common mistakes", "Read more"]);
	assert.equal(fastTrackNotes(md), "## The big idea — x\n\nBig.\n\n## The math\n\n$$a$$\n\n## Common mistakes\n\n- one");
	assert.equal(fastTrackNotes("no headings"), null);
});

test("a blank multiple-choice answer is wrong, not option 0", async () => {
	const { gradeDeterministic } = await import("../src/core/assessments.ts");
	const q = { kind: "mc" as const, prompt: "p", options: ["a", "b", "c"], answer: 0, explanation: "e" };
	assert.equal(gradeDeterministic(q, "")?.correct, false);
	assert.equal(gradeDeterministic(q, "0")?.correct, true);
});
