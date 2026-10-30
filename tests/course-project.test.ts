/**
 * Course capstone projects: optional and off the lesson path. A course may
 * carry a `project`; `project_done` marks it done in the snapshot and
 * changes nothing else (mastery, streaks, XP, pace).
 */
import assert from "node:assert";
import test from "node:test";
import { courseSchema, type Course, type Program, type ProgressEvent } from "../src/core/contracts/curriculum.ts";
import { indexProgram } from "../src/core/curriculum.ts";
import { deriveProgress } from "../src/core/progress.ts";

const project = {
	title: "Tiny GPT",
	summary: "Build and train a tiny GPT.",
	goals: ["Implement attention", "Train on a small corpus"],
	steps: ["Tokenize", "Model", "Train"],
	stack: "Python, PyTorch",
	hours: 20,
};
function course(withProject: boolean): Course {
	return courseSchema.parse({
		id: "a4",
		code: "A4",
		title: "Modern AI",
		track: "ai",
		depth: "core",
		hours: 10,
		subject: "Modern AI",
		summary: "s",
		units: [{ id: "a4-u1", title: "U1", summary: "s", lessons: [1, 2, 3].map((n) => ({ id: `a4-${n}`, title: `L${n}`, minutes: 30, objectives: ["x", "y"] })) }],
		...(withProject ? { project } : {}),
	});
}
const at = (d: string) => `${d}T12:00:00.000Z`;

test("the ai track and an optional project parse; a bad project is rejected", () => {
	assert.equal(course(true).project?.title, "Tiny GPT");
	assert.equal(course(false).project, undefined);
	assert.throws(() => courseSchema.parse({ ...course(false), project: { ...project, steps: ["only one"] } }));
});

test("project_done is recorded once and changes nothing else", () => {
	const program: Program = { id: "p", title: "P", summary: "s", targetWeeks: 4, hoursPerWeek: 8, courses: ["a4"], courseList: [course(true)] };
	const index = indexProgram(program);
	const base: ProgressEvent[] = [
		{ type: "study_time", at: at("2026-11-02"), minutes: 20, source: "manual" },
		{ type: "quick_check", at: at("2026-11-03"), lessonId: "a4-1", score: 1 },
	];
	const done: ProgressEvent[] = [...base, { type: "project_done", at: at("2026-11-04"), courseId: "a4" }, { type: "project_done", at: at("2026-11-05"), courseId: "a4" }];
	const now = { now: new Date(at("2026-11-06")) };
	const before = deriveProgress(index, base, now);
	const after = deriveProgress(index, done, now);
	assert.deepEqual(before.projectsDone, []);
	assert.deepEqual(after.projectsDone, ["a4"]);
	const { projectsDone: _a, ...restBefore } = before;
	const { projectsDone: _b, ...restAfter } = after;
	assert.deepEqual(restAfter, restBefore);
});
