import assert from "node:assert/strict";
import { test } from "node:test";
import type { LhMessage } from "../src/core/native-messages.ts";
import { feedsGraph, isProgramSession, newLessonContextMessage, newUserMessage } from "../src/core/native-messages.ts";
import { scheduleIdleExtraction } from "../src/server/turn-service.ts";
import type { ExtractionPipeline } from "../src/agent/subagents/extraction.ts";

const brief = newLessonContextMessage("Lesson brief", {} as never);
const prose = (id: string, text: string) => ({ id, role: "assistant", content: [{ type: "text", text }] }) as unknown as LhMessage;

test("program sessions feed the graph whatever their kind; free-form practice does not", () => {
	const program = [brief, newUserMessage("ready")];
	assert.equal(isProgramSession(program), true);
	assert.equal(feedsGraph({ kind: "practice", messages: program }), true);
	assert.equal(feedsGraph({ kind: "practice", messages: [newUserMessage("practice fractions")] }), false);
	assert.equal(feedsGraph({ messages: [newUserMessage("teach me")] }), true);
});

test("the quiet timer runs one extraction, and a new turn restarts it", async () => {
	const runs: string[] = [];
	const extraction = { runExtraction: async (id: string) => { runs.push(id); return {} as never; } } as unknown as ExtractionPipeline;
	const messages = [brief, prose("a1", "The product rule adds exponents: x^m·x^n = x^(m+n).")];
	const deps = {
		chatStore: { getChat: () => ({ id: "chat_1", kind: "practice", messages }) } as never,
		graphStore: { readCoverage: () => [] } as never,
		enabled: () => true,
	};
	scheduleIdleExtraction(deps, extraction, "chat_1", 40);
	await new Promise((r) => setTimeout(r, 25));
	scheduleIdleExtraction(deps, extraction, "chat_1", 40); // a new turn
	await new Promise((r) => setTimeout(r, 25));
	assert.deepEqual(runs, [], "restarted before it fired");
	await new Promise((r) => setTimeout(r, 40));
	assert.deepEqual(runs, ["chat_1"]);
});

test("the quiet timer skips when the graph is off or nothing is new", async () => {
	const runs: string[] = [];
	const extraction = { runExtraction: async (id: string) => { runs.push(id); return {} as never; } } as unknown as ExtractionPipeline;
	const off = { chatStore: { getChat: () => ({ id: "c", messages: [brief, prose("a1", "text")] }) } as never, graphStore: { readCoverage: () => [] } as never, enabled: () => false };
	scheduleIdleExtraction(off, extraction, "c", 5);
	const empty = { chatStore: { getChat: () => ({ id: "d", messages: [brief] }) } as never, graphStore: { readCoverage: () => [] } as never, enabled: () => true };
	scheduleIdleExtraction(empty, extraction, "d", 5);
	await new Promise((r) => setTimeout(r, 30));
	assert.deepEqual(runs, []);
});
