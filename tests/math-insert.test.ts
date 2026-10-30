/**
 * math-insert — splicing MathLive formulas into answer text, and turning a
 * formula typed for a NUMERIC question into text parseNumber reads.
 */
import assert from "node:assert";
import test from "node:test";
import { latexToNumberText, spliceMath } from "../lib/math-insert.ts";
import { parseNumber } from "../src/core/assessments.ts";

test("inline math lands at the cursor as $…$, padded off neighbouring words", () => {
	assert.deepEqual(spliceMath("", 0, 0, "\\frac{a}{b}"), { value: "$\\frac{a}{b}$ ", caret: 14 });
	assert.equal(spliceMath("so x=", 5, 5, "\\alpha")!.value, "so x= $\\alpha$ ");
	assert.equal(spliceMath("so  then", 3, 3, "\\alpha")!.value, "so $\\alpha$ then");
	assert.equal(spliceMath("sotext", 2, 2, "\\pi")!.value, "so $\\pi$ text");
	assert.equal(spliceMath("value .", 6, 6, "x")!.value, "value $x$.");
	// A selection is replaced.
	assert.equal(spliceMath("a OLD b", 2, 5, "y")!.value, "a $y$ b");
	const r = spliceMath("ab", 1, 1, "x")!;
	assert.equal(r.value.slice(0, r.caret), "a $x$ ");
});

test("display math gets its own lines as $$…$$", () => {
	assert.equal(spliceMath("", 0, 0, "\\int_0^1 x\\,dx", true)!.value, "$$\n\\int_0^1 x\\,dx\n$$\n");
	assert.equal(spliceMath("First line", 10, 10, "E=mc^2", true)!.value, "First line\n\n$$\nE=mc^2\n$$\n");
	assert.equal(spliceMath("a\nb", 2, 2, "x", true)!.value, "a\n\n$$\nx\n$$\n\nb");
});

test("empty formulas insert nothing", () => {
	assert.equal(spliceMath("abc", 1, 1, "  "), null);
});

test("numeric answers: MathLive LaTeX becomes text parseNumber reads", () => {
	const cases: [string, string, number][] = [
		["3.2\\times10^{-5}", "3.2×10^-5", 3.2e-5],
		["3.2\\cdot10^{-5}", "3.2×10^-5", 3.2e-5],
		["6.67\\times10^{-11}\\,\\mathrm{N\\,m^2/kg^2}", "6.67×10^-11 Nm^2/kg^2", 6.67e-11],
		["3\\times10^{8}", "3×10^8", 3e8],
		["-4", "-4", -4],
		["1\\,200", "1200", 1200],
		["\\frac{1}{4}", "0.25", 0.25],
		["\\frac14", "0.25", 0.25], // MathLive's own serialization
		["\\frac{3}{8}", "0.375", 0.375],
		["\\frac{6}{1.5}\\times10^{3}", "4×10^3", 4000],
		["-\\frac{3}{2}", "-1.5", -1.5],
		["2{,}5", "2.5", 2.5],
		["9.81\\,\\mathrm{m/s^2}", "9.81 m/s^2", 9.81],
		["4.2e-3", "4.2e-3", 4.2e-3],
	];
	for (const [latex, text, n] of cases) {
		assert.equal(latexToNumberText(latex), text, latex);
		assert.equal(parseNumber(text), n, `parseNumber(${text})`);
	}
});

test("numeric answers: expressions and symbols are refused, not half-read", () => {
	for (const latex of ["3+4", "\\frac{a}{b}", "\\sqrt{2}", "x", "\\pi", "2\\pi", ""]) assert.equal(latexToNumberText(latex), null, latex);
});
