/**
 * Pure text helpers for the math input (components/math-input.tsx): splice a
 * MathLive LaTeX formula into markdown answer text as `$…$` / `$$…$$`, and
 * turn a formula typed into a NUMERIC answer back into plain text the
 * server's parseNumber (src/core/assessments.ts) reads.
 */

export interface MathSplice {
	value: string;
	/** Caret offset just after the inserted formula. */
	caret: number;
}

/** Insert `latex` into `value` over the selection [start, end), wrapped as
 *  inline `$…$` (padded with a space where it would touch a word) or as a
 *  display `$$…$$` block on its own lines. Null for an empty formula. */
export function spliceMath(value: string, start: number, end: number, latex: string, display = false): MathSplice | null {
	const tex = latex.trim();
	if (!tex) return null;
	const lo = Math.max(0, Math.min(start, end, value.length));
	const hi = Math.min(value.length, Math.max(start, end, lo));
	const before = value.slice(0, lo);
	const after = value.slice(hi);
	let snippet: string;
	if (display) {
		const pre = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
		const post = after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
		snippet = `${pre}$$\n${tex}\n$$${post}`;
	} else {
		const pre = before === "" || /\s$/.test(before) ? "" : " ";
		// A trailing space when the formula ends the text, so typing carries on
		// after it; none before whitespace or closing punctuation.
		const post = after === "" ? " " : /^[\s.,;:!?)\]}]/.test(after) ? "" : " ";
		snippet = `${pre}$${tex}$${post}`;
	}
	return { value: before + snippet + after, caret: before.length + snippet.length };
}

const NUMBER = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*×\s*10\^-?\d+|e[-+]?\d+)?)\s*(.*)$/i;

/** One numeric value in plain text, from MathLive LaTeX — e.g.
 *  `3.2\times10^{-5}` → `3.2×10^-5`, `\frac{1}{4}` → `0.25`, `1\,200` → `1200`.
 *  A trailing unit (`\mathrm{m/s}`) is kept as text. Null when the formula
 *  is not a single number (an expression like `3+4` would otherwise parse
 *  as its first term). */
export function latexToNumberText(latex: string): string | null {
	let s = latex
		.trim()
		.replace(/\\[,;:! ]|~/g, "") // TeX spacing
		.replace(/\\(?:left|right)(?![A-Za-z])/g, "")
		.replace(/\{,\}/g, ".") // MathLive's decimal comma
		.replace(/\\(?:times|cdot|ast)(?![A-Za-z])/g, "×")
		.replace(/[−–]/g, "-")
		.replace(/\\(?:mathrm|text|operatorname|mathit)\{([^{}]*)\}/g, " $1 ")
		.replace(/\\mu(?![A-Za-z])/g, "μ")
		.replace(/\\Omega(?![A-Za-z])/g, "Ω")
		.replace(/\^\{\s*\+?\s*(-?\d+)\s*\}/g, "^$1")
		.replace(/\^\+?(-?\d)/g, "^$1");
	// Numeric fractions → decimals (numerator and denominator each a number).
	// MathLive writes single-character arguments without braces: \frac14.
	s = s.replace(/\\[dt]?frac\s*(\{[^{}]*\}|[^\s{}\\])\s*(\{[^{}]*\}|[^\s{}\\])/g, (whole, num: string, den: string) => {
		const a = plainNumber(num.replace(/^\{|\}$/g, ""));
		const b = plainNumber(den.replace(/^\{|\}$/g, ""));
		return a !== null && b !== null && b !== 0 ? String(a / b) : whole;
	});
	s = s.replace(/\s*×\s*/g, "×").replace(/\s+/g, " ").trim();
	const m = NUMBER.exec(s);
	if (!m) return null;
	const rest = m[2] ?? "";
	// Anything after the number must be a unit (starts with a letter), not
	// more arithmetic.
	if (rest && !/^[A-Za-zμµΩ°%]/.test(rest)) return null;
	if (/\\|[{}]/.test(rest)) return null;
	return rest ? `${m[1]} ${rest}` : (m[1] ?? null);
}

function plainNumber(raw: string): number | null {
	const t = raw.replace(/\s+/g, "");
	const m = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(?:×10\^(-?\d+))?$/.exec(t);
	if (!m) return null;
	return Number(m[1]) * (m[2] ? 10 ** Number(m[2]) : 1);
}
