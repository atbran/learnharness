/**
 * The tutor can finish a lesson ("Tutor + proof", owner 2026-11-01):
 * lesson_mastered counts only when every plan step's latest tagged check
 * was passed, and tutor_mastered replays like a passing quick check.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { courseSchema, type Program, type ProgressEvent } from "../src/core/contracts/curriculum.ts";
import type { PlanTree } from "../src/core/contracts/plan.ts";
import { indexProgram } from "../src/core/curriculum.ts";
import { masterableLessonOf, newLessonContextMessage, unprovenPlanSteps, type LhMessage } from "../src/core/native-messages.ts";
import { deriveProgress } from "../src/core/progress.ts";
import { lessonMasteredTool } from "../src/agent/tools/lesson-mastered.ts";

const tree: PlanTree = {
	nodes: [
		{ id: "square", title: "Complete the square" },
		{ id: "vertex", title: "Read the vertex" },
	],
	edges: [{ from: "square", to: "vertex" }],
} as PlanTree;

let n = 0;
/** One tagged check: the call, and (unless `answer` is null) its answer. */
function check(nodeId: string, answer: Record<string, unknown> | null, tool = "quiz"): LhMessage[] {
	const id = `call_${++n}`;
	const call = { id: `a_${id}`, role: "assistant", content: [{ type: "toolCall", id, name: tool, arguments: { question: "q", nodeId } }] } as unknown as LhMessage;
	if (!answer) return [call];
	const result = {
		id: `r_${id}`,
		role: "toolResult",
		toolCallId: id,
		toolName: tool,
		isError: false,
		content: [],
		details: { kind: tool === "explain" ? "explain" : "quiz", questionText: "q", dontKnow: false, answers: [], answeredAt: "2026-11-01T00:00:00Z", ...answer },
	} as unknown as LhMessage;
	return [call, result];
}
const right = { correct: true };
const wrong = { correct: false };
const titles = (msgs: LhMessage[]) => unprovenPlanSteps(tree, msgs).map((s) => s.title);

test("a step is proven by its latest tagged check", () => {
	assert.deepEqual(titles([...check("square", right), ...check("vertex", right)]), []);
	assert.deepEqual(titles([...check("square", right)]), ["Read the vertex"], "untested step");
	assert.deepEqual(titles([...check("square", right), ...check("vertex", right), ...check("square", wrong)]), ["Complete the square"], "a later miss un-proves");
	assert.deepEqual(titles([...check("square", wrong), ...check("square", right), ...check("vertex", right)]), [], "a later pass proves");
	assert.deepEqual(titles([...check("square", right), ...check("vertex", right), ...check("vertex", null)]), ["Read the vertex"], "an unanswered latest check");
});

test("don't-know, dismissed and asked answers prove nothing; an answered explain does", () => {
	for (const non of [{ dontKnow: true }, { dismissed: true }, { asked: "why?" }])
		assert.deepEqual(titles([...check("square", right), ...check("vertex", { correct: true, ...non })]), ["Read the vertex"]);
	assert.deepEqual(titles([...check("square", right), ...check("vertex", {}, "explain")]), []);
});

test("tags for steps a map rewrite dropped are ignored; untagged probes never count", () => {
	const probe = { id: "a_p", role: "assistant", content: [{ type: "toolCall", id: "p1", name: "probe", arguments: { question: "q" } }] } as unknown as LhMessage;
	assert.deepEqual(titles([probe, ...check("old-step", right), ...check("square", right), ...check("vertex", right)]), []);
});

test("only lesson teach sessions are masterable", () => {
	const ctx = (details: object) => [newLessonContextMessage("brief", details as never)];
	assert.equal(masterableLessonOf(ctx({ lessonId: "m0-1", mode: "teach" })), "m0-1");
	assert.equal(masterableLessonOf(ctx({ lessonId: "m0-1", mode: "teach", kind: "teach-back" })), null);
	assert.equal(masterableLessonOf(ctx({ lessonId: "m0-1", mode: "practice" })), null);
	assert.equal(masterableLessonOf([]), null);
});

function harness(messages: LhMessage[], opts: { tree?: PlanTree | null; mastered?: boolean } = {}) {
	const recorded: string[] = [];
	let mastered = opts.mastered ?? false;
	const record = { id: "chat_1", messages, ...(opts.tree === null ? {} : { tree: opts.tree ?? tree }) };
	const tool = lessonMasteredTool({
		chatId: "chat_1",
		chatStore: { getChat: () => record } as never,
		lessonId: "m0-1",
		isMastered: () => mastered,
		recordMastered: () => {
			recorded.push("m0-1");
			mastered = true;
		},
	}).lesson_mastered!;
	const call = () => tool.execute("t", { summary: "You can complete the square and read the vertex." }).then((r) => r.details as { ok: boolean; error?: string; alreadyMastered?: boolean });
	return { call, recorded };
}

test("lesson_mastered refuses without proof and names the unproven steps", async () => {
	const open = harness([...check("square", right), ...check("vertex", null)]);
	assert.match((await open.call()).error ?? "", /still open/);
	const noMap = harness([...check("square", right)], { tree: null });
	assert.match((await noMap.call()).error ?? "", /No plan map/);
	const missing = harness([...check("square", right), ...check("vertex", wrong)]);
	const res = await missing.call();
	assert.equal(res.ok, false);
	assert.match(res.error ?? "", /Read the vertex \[vertex\]/);
	assert.doesNotMatch(res.error ?? "", /Complete the square/);
	assert.deepEqual([...open.recorded, ...noMap.recorded, ...missing.recorded], []);
});

test("lesson_mastered records once when every step is proven", async () => {
	const h = harness([...check("square", right), ...check("vertex", right)]);
	assert.deepEqual(await h.call(), { ok: true });
	assert.deepEqual(h.recorded, ["m0-1"]);
	assert.deepEqual(await h.call(), { ok: true, alreadyMastered: true });
	assert.deepEqual(h.recorded, ["m0-1"], "a second call writes nothing");
});

test("tutor_mastered replays like a passing quick check", () => {
	const course = courseSchema.parse({
		id: "m0",
		code: "M0",
		title: "Precalc",
		track: "math",
		depth: "core",
		hours: 10,
		subject: "Math",
		summary: "s",
		units: [{ id: "m0-u1", title: "U1", summary: "s", lessons: [1, 2].map((i) => ({ id: `m0-${i}`, title: `L${i}`, minutes: 30, objectives: ["x", "y"] })) }],
	});
	const program: Program = { id: "p", title: "P", summary: "s", targetWeeks: 4, hoursPerWeek: 8, courses: ["m0"], courseList: [course] };
	const index = indexProgram(program);
	const at = "2026-11-01T12:00:00.000Z";
	const now = { now: new Date("2026-11-02T12:00:00.000Z") };
	const viaCheck = deriveProgress(index, [{ type: "quick_check", at, lessonId: "m0-1", score: 0.8 }], now);
	const viaTutor = deriveProgress(index, [{ type: "tutor_mastered", at, lessonId: "m0-1", chatId: "chat_1" }], now);
	const t = viaTutor.lessons["m0-1"]!;
	assert.equal(t.masteredAt, at);
	assert.equal(t.masteredBy, "tutor");
	assert.deepEqual(t.review, viaCheck.lessons["m0-1"]!.review);
	assert.equal(viaTutor.lessons["m0-2"]!.status, viaCheck.lessons["m0-2"]!.status, "the next lesson unlocks the same way");
	assert.ok(viaTutor.xp > 0);

	// An earlier quick-check mastery is kept; the later tutor call adds nothing.
	const both: ProgressEvent[] = [
		{ type: "quick_check", at, lessonId: "m0-1", score: 1 },
		{ type: "tutor_mastered", at: "2026-11-01T13:00:00.000Z", lessonId: "m0-1", chatId: "chat_1" },
	];
	const kept = deriveProgress(index, both, now);
	assert.equal(kept.lessons["m0-1"]!.masteredBy, "check");
	assert.equal(kept.lessons["m0-1"]!.masteredAt, at);
	assert.equal(kept.xp, deriveProgress(index, both.slice(0, 1), now).xp);
});
