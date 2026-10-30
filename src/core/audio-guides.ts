/**
 * Audio guides — the pure parts: HTTP Range parsing for the OGG file route,
 * and markdown/LaTeX → speakable text for Kokoro (a finished teaching
 * session's teacher prose, or a safety pass over a written script).
 *
 * The speech pass is deliberately conservative: prose outside math is left
 * alone apart from markdown syntax; math ($…$, $$…$$, \(…\), \[…\]) is read
 * out in words for the common notation and replaced by a pointer to the
 * transcript when it is too dense to say.
 */

import { failedOutputCallIds, userFacingTextOf, type LhMessage } from "./native-messages.ts";

// ─── Range ──────────────────────────────────────────────────────────────────

/** One byte range, inclusive both ends (Content-Range semantics). */
export interface ByteRange {
	start: number;
	end: number;
}

/**
 * Parse a `Range` header against a file of `size` bytes.
 * - `null`: no usable range → serve the whole file (200). Multi-range and
 *   non-byte units fall here too (RFC 9110 lets a server ignore Range).
 * - `"unsatisfiable"`: syntactically fine but outside the file → 416.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
	if (!header) return null;
	const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
	if (!m) return null;
	const [, a, b] = m;
	if (a === "" && b === "") return null;
	if (a === "") {
		// suffix: the last N bytes
		const n = Number(b);
		if (n === 0) return "unsatisfiable";
		if (size === 0) return "unsatisfiable";
		return { start: Math.max(0, size - n), end: size - 1 };
	}
	const start = Number(a);
	if (start >= size) return "unsatisfiable";
	const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
	if (end < start) return null; // invalid range-spec → ignore the header
	return { start, end };
}

// ─── Speech ─────────────────────────────────────────────────────────────────

const GREEK = [
	"alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu",
	"xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
	"Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega",
];

const WORDS: Record<string, string> = {
	hbar: "h bar",
	infty: "infinity",
	partial: "partial",
	nabla: "del",
	cdot: "times",
	times: "times",
	div: "divided by",
	pm: "plus or minus",
	mp: "minus or plus",
	approx: "is approximately",
	sim: "is of order",
	propto: "is proportional to",
	equiv: "is defined as",
	neq: "is not equal to",
	ne: "is not equal to",
	le: "is at most",
	leq: "is at most",
	ge: "is at least",
	geq: "is at least",
	ll: "is much less than",
	gg: "is much greater than",
	to: "goes to",
	rightarrow: "goes to",
	Rightarrow: "implies",
	implies: "implies",
	iff: "if and only if",
	in: "in",
	sum: "the sum",
	prod: "the product",
	int: "the integral",
	oint: "the closed integral",
	iint: "the double integral",
	iiint: "the triple integral",
	lim: "the limit",
	sin: "sine",
	cos: "cosine",
	tan: "tangent",
	ln: "natural log of",
	log: "log of",
	exp: "e to the",
	det: "determinant of",
	dagger: "dagger",
	langle: "",
	rangle: "",
	left: "",
	right: "",
	quad: "",
	qquad: "",
	displaystyle: "",
	mathrm: "",
	mathbf: "",
	mathit: "",
	mathcal: "",
	boldsymbol: "",
	text: "",
	operatorname: "",
	ldots: "and so on",
	cdots: "and so on",
	dots: "and so on",
};
for (const g of GREEK) WORDS[g] ??= g.replace(/^var/, "").toLowerCase();

/** Innermost-first `\cmd{a}{b}` rewrite (no nested braces inside a or b). */
function rewriteBraced(s: string, cmd: string, arity: 1 | 2, say: (...args: string[]) => string): string {
	const re = arity === 1 ? new RegExp(`\\\\${cmd}\\s*\\{([^{}]*)\\}`, "g") : new RegExp(`\\\\${cmd}\\s*\\{([^{}]*)\\}\\s*\\{([^{}]*)\\}`, "g");
	let prev: string;
	do {
		prev = s;
		s = s.replace(re, (_m, a: string, b: string) => say(a, b));
	} while (s !== prev);
	return s;
}

function power(exp: string): string {
	const e = exp.trim();
	if (e === "2") return " squared";
	if (e === "3") return " cubed";
	if (e === "-1") return " inverse";
	if (e === "\\dagger" || e === "dagger") return " dagger";
	if (e === "*") return " star";
	if (e === "\\prime" || e === "'") return " prime";
	return ` to the ${e}`;
}

/** One math span → words; `null` when it stays too dense to say. */
export function speakMath(tex: string): string | null {
	let s = tex.trim();
	s = s.replace(/\\(?:,|;|:|!|\s)/g, " ");
	s = s.replace(/\\(?:begin|end)\{[^}]*\}/g, " ").replace(/&/g, " ").replace(/\\\\/g, ", ");
	s = rewriteBraced(s, "frac", 2, (a, b) => ` ${a} over ${b} `);
	s = rewriteBraced(s, "dfrac", 2, (a, b) => ` ${a} over ${b} `);
	s = rewriteBraced(s, "tfrac", 2, (a, b) => ` ${a} over ${b} `);
	s = rewriteBraced(s, "sqrt", 1, (a) => ` the square root of ${a} `);
	s = rewriteBraced(s, "vec", 1, (a) => ` vector ${a} `);
	s = rewriteBraced(s, "hat", 1, (a) => ` ${a} hat `);
	s = rewriteBraced(s, "bar", 1, (a) => ` ${a} bar `);
	s = rewriteBraced(s, "dot", 1, (a) => ` ${a} dot `);
	s = rewriteBraced(s, "ddot", 1, (a) => ` ${a} double dot `);
	s = rewriteBraced(s, "tilde", 1, (a) => ` ${a} tilde `);
	for (const wrap of ["mathrm", "mathbf", "mathit", "mathcal", "boldsymbol", "text", "operatorname"]) s = rewriteBraced(s, wrap, 1, (a) => ` ${a} `);
	s = s.replace(/\\(?:vec|hat|bar|dot|tilde)\s*([A-Za-z])/g, " $1 ");
	s = s.replace(/\^\s*\{([^{}]*)\}/g, (_m, e: string) => power(e));
	s = s.replace(/\^\s*(\\[A-Za-z]+|[A-Za-z0-9*'])/g, (_m, e: string) => power(e));
	s = s.replace(/_\s*\{([^{}]*)\}/g, " sub $1 ").replace(/_\s*(\\?[A-Za-z0-9]+)/g, " sub $1 ");
	s = s.replace(/\\([A-Za-z]+)/g, (m, name: string) => (name in WORDS ? ` ${WORDS[name]} ` : m));
	s = s.replace(/\bd([a-z])\s*\/\s*d([a-z])\b/g, " d $1 d $2 ");
	s = s
		.replace(/<=|≤/g, " is at most ")
		.replace(/>=|≥/g, " is at least ")
		.replace(/=/g, " equals ")
		.replace(/</g, " is less than ")
		.replace(/>/g, " is greater than ")
		.replace(/\+/g, " plus ")
		.replace(/[-−]/g, " minus ")
		.replace(/\//g, " over ")
		.replace(/\*/g, " times ")
		.replace(/[{}]/g, " ")
		.replace(/\(\s*/g, " ")
		.replace(/\s*\)/g, " ")
		.replace(/[[\]|]/g, " ");
	s = s.replace(/\s+/g, " ").trim();
	if (!s) return "";
	// Leftover commands or a long run means it won't survive speech.
	if (/\\[A-Za-z]/.test(s) || s.length > 160) return null;
	return s;
}

const DENSE = "(there's an equation here; see the transcript)";

/** Markdown + LaTeX → plain speakable paragraphs (blank-line separated). */
export function speakableText(markdown: string): string {
	let s = markdown.replace(/\r\n/g, "\n");
	s = s.replace(/```[\s\S]*?```/g, "\n\n(There's a code block here; see the transcript.)\n\n");
	s = s.replace(/<[^>\n]+>/g, " "); // html tags
	// Display math first, then inline; read out what can be said.
	const math = (_m: string, tex: string, display: boolean) => {
		const said = speakMath(tex);
		const words = said === null ? DENSE : said;
		return display ? `\n\n${words}.\n\n` : words;
	};
	s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, t: string) => math(m, t, true));
	s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, t: string) => math(m, t, true));
	s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, t: string) => math(m, t, false));
	s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, pre: string, t: string) => pre + math(_m, t, false));
	s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images
	s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → text
	s = s.replace(/^\s*\|?\s*:?-{3,}.*$/gm, ""); // table separator rows
	s = s.replace(/^\s*\|(.*)\|\s*$/gm, (_m, row: string) => `${row.split("|").map((c) => c.trim()).filter(Boolean).join(", ")}.`);
	s = s.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_m, h: string) => `\n${h.replace(/[.:!?]$/, "")}.\n`);
	s = s.replace(/^\s{0,3}>\s?/gm, "");
	s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "");
	s = s.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");
	s = s.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2");
	s = s.replace(/`([^`]+)`/g, "$1");
	s = s.replace(/~~(.+?)~~/g, "$1");
	s = s.replace(/[→⇒]/g, " to ").replace(/[–—]/g, ", ").replace(/…/g, "...");
	return s
		.split(/\n\s*\n/)
		.map((p) => p.replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/,\s*,/g, ",").trim())
		.filter((p) => p && /[A-Za-z0-9]/.test(p))
		.join("\n\n");
}

/** The teacher's delivered prose of a session (the same text the session
 *  markdown renders under "Teacher"), cleaned for speech. */
export function teacherSpeech(messages: ReadonlyArray<LhMessage>): string {
	const failed = failedOutputCallIds(messages as LhMessage[]);
	const parts: string[] = [];
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") continue;
		for (const text of userFacingTextOf((message as { content: unknown }).content, failed)) {
			const said = speakableText(text);
			if (said) parts.push(said);
		}
	}
	return parts.join("\n\n");
}

/** A guide id is a lesson id or a chat id (`chat_…`). */
export function isChatGuideId(id: string): boolean {
	return id.startsWith("chat_");
}
