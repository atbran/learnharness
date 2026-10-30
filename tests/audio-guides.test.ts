/**
 * audio guides — Range parsing for the OGG route, markdown/LaTeX → speech,
 * and teacher-prose extraction from a session.
 */
import assert from "node:assert";
import test from "node:test";
import { isChatGuideId, parseRange, speakMath, speakableText, teacherSpeech } from "../src/core/audio-guides.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

test("parseRange: open, closed, suffix, and clamped ranges", () => {
	assert.deepEqual(parseRange("bytes=0-", 1000), { start: 0, end: 999 });
	assert.deepEqual(parseRange("bytes=100-199", 1000), { start: 100, end: 199 });
	assert.deepEqual(parseRange("bytes=900-5000", 1000), { start: 900, end: 999 });
	assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
	assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999 });
	assert.deepEqual(parseRange(" Bytes = 5 - 9 ", 1000), { start: 5, end: 9 });
});

test("parseRange: ignorable headers serve the whole file; out-of-file is 416", () => {
	assert.equal(parseRange(null, 1000), null);
	assert.equal(parseRange("", 1000), null);
	assert.equal(parseRange("items=0-5", 1000), null);
	assert.equal(parseRange("bytes=0-5,10-20", 1000), null); // multi-range
	assert.equal(parseRange("bytes=-", 1000), null);
	assert.equal(parseRange("bytes=50-10", 1000), null);
	assert.equal(parseRange("bytes=1000-", 1000), "unsatisfiable");
	assert.equal(parseRange("bytes=-0", 1000), "unsatisfiable");
	assert.equal(parseRange("bytes=0-", 0), "unsatisfiable");
});

test("speakMath reads common notation in words", () => {
	assert.equal(speakMath("E = mc^2"), "E equals mc squared");
	assert.equal(speakMath("\\frac{1}{2} m v^2"), "1 over 2 m v squared");
	assert.equal(speakMath("F = -kx"), "F equals minus kx");
	assert.equal(speakMath("\\hbar \\omega"), "h bar omega");
	assert.equal(speakMath("x_0"), "x sub 0");
	assert.equal(speakMath("\\sqrt{2}"), "the square root of 2");
	assert.equal(speakMath("e^{i\\theta}"), "e to the i theta");
	assert.equal(speakMath("\\Delta x \\ge 0"), "delta x is at least 0");
});

test("speakMath gives up on notation it cannot say", () => {
	assert.equal(speakMath("\\mathfrak{g} \\otimes \\mathfrak{h}"), null);
	assert.equal(speakMath("a + ".repeat(60)), null);
});

test("speakableText strips markdown and reads inline math", () => {
	const md = [
		"## Energy conservation",
		"",
		"The **total** energy is $E = T + V$, and *nothing* is lost.",
		"",
		"- first, the [kinetic](https://example.com) term",
		"- then `V(x)`",
		"",
		"$$\\mathfrak{L} \\otimes \\mathfrak{M}$$",
		"",
		"```python\nprint(1)\n```",
	].join("\n");
	const out = speakableText(md);
	assert.ok(!/[*#`$\\[\]]/.test(out), out);
	assert.match(out, /^Energy conservation\./);
	assert.match(out, /The total energy is E equals T plus V, and nothing is lost\./);
	assert.match(out, /first, the kinetic term/);
	assert.match(out, /see the transcript/);
	assert.match(out, /code block/);
	assert.equal(out.split("\n\n").length >= 4, true);
});

test("speakableText leaves plain prose alone", () => {
	const prose = "Think of a ball rolling down a hill - it speeds up.\n\nThat's the whole idea.";
	assert.equal(speakableText(prose), "Think of a ball rolling down a hill - it speeds up.\n\nThat's the whole idea.");
});

test("teacherSpeech keeps only the teacher's delivered text", () => {
	const messages = [
		{ id: "m1", role: "user", content: "I'm ready", timestamp: 0 },
		{ id: "m2", role: "assistant", content: [{ type: "text", text: "Momentum is $p = mv$." }], stopReason: "stop", timestamp: 1 },
		{ id: "m3", role: "custom", customType: "lesson-context", content: "brief", display: true, timestamp: 2 },
		{ id: "m4", role: "assistant", content: [{ type: "text", text: "**Next**, force." }], stopReason: "stop", timestamp: 3 },
	] as unknown as LhMessage[];
	assert.equal(teacherSpeech(messages), "Momentum is p equals mv.\n\nNext, force.");
});

test("guide ids: chat sessions vs lessons", () => {
	assert.equal(isChatGuideId("chat_lx2_ab12cd34"), true);
	assert.equal(isChatGuideId("m0-l001-exponents-radicals"), false);
});
