/**
 * Bookshelf — pure logic over an ingested textbook: section spans from the
 * PDF outline, curriculum reading refs ("§2.3", "Ch. 4", "4.2-4.4") resolved
 * to page ranges, snippet chunking, and FTS query building. No IO; the
 * SQLite adapter is src/store/bookshelf.ts.
 */

export interface OutlineEntry {
	title: string;
	level: number;
	/** 1-based PDF page, or null when the bookmark didn't resolve. */
	page: number | null;
}

export interface SectionSpan {
	title: string;
	level: number;
	/** The leading number in the title ("2.3", "4", "A"), when present. */
	number: string | null;
	start: number;
	end: number;
}

export interface PageText {
	page: number;
	label: string | null;
	text: string;
}

export interface ResolvedRef {
	start: number;
	end: number;
	matched: string;
	via: "outline-number" | "outline-title" | "text";
}

const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "for", "with", "its", "is", "at", "by", "as", "from"]);

export function normalizeWords(s: string): string[] {
	return s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.split(" ")
		.filter((w) => w && !STOP.has(w));
}

export function titleSimilarity(a: string, b: string): number {
	const A = new Set(normalizeWords(a));
	const B = new Set(normalizeWords(b));
	if (A.size === 0 || B.size === 0) return 0;
	let inter = 0;
	for (const w of A) if (B.has(w)) inter++;
	return inter / Math.min(A.size, B.size) * (inter / Math.max(A.size, B.size)) ** 0.25;
}

/** The leading section number in an outline title or heading line. */
export function leadingNumber(title: string): string | null {
	const m = /^\s*(?:chapter|ch\.?|section|sec\.?|§|part)?\s*(\d+(?:\.\d+)*)(?=[\s.:–—-]|$)/i.exec(title);
	if (m) return m[1]!.replace(/\.$/, "");
	const a = /^\s*appendix\s+([A-Z])\b/i.exec(title);
	return a ? a[1]!.toUpperCase() : null;
}

export interface ParsedRef {
	kind: "section" | "chapter" | "range" | "appendix" | "unknown";
	from: string | null;
	to: string | null;
}

export function parseRef(ref: string): ParsedRef {
	const r = ref.trim();
	const app = /appendix\s+([A-Z])/i.exec(r);
	if (app) return { kind: "appendix", from: app[1]!.toUpperCase(), to: null };
	const range = /(\d+(?:\.\d+)+)\s*[-–—]\s*(\d+(?:\.\d+)*)/.exec(r);
	if (range) {
		const from = range[1]!;
		let to = range[2]!;
		if (!to.includes(".")) to = `${from.split(".")[0]}.${to}`;
		return { kind: "range", from, to };
	}
	const ch = /^(?:ch(?:apter)?\.?\s*)(\d+)\b/i.exec(r);
	if (ch) return { kind: "chapter", from: ch[1]!, to: null };
	const sec = /(\d+(?:\.\d+)*)/.exec(r);
	if (sec) return { kind: sec[1]!.includes(".") ? "section" : "chapter", from: sec[1]!, to: null };
	return { kind: "unknown", from: null, to: null };
}

/** Outline entries → spans: each runs to the page before the next entry at
 *  the same or a shallower level (never shorter than its own page). */
export function sectionSpans(outline: readonly OutlineEntry[], pageCount: number): SectionSpan[] {
	const withPages = outline.filter((e): e is OutlineEntry & { page: number } => e.page !== null);
	return withPages.map((e, i) => {
		let end = pageCount;
		for (let j = i + 1; j < withPages.length; j++) {
			if (withPages[j]!.level <= e.level) {
				end = Math.max(e.page, withPages[j]!.page - (withPages[j]!.page > e.page ? 1 : 0));
				break;
			}
		}
		return { title: e.title, level: e.level, number: leadingNumber(e.title), start: e.page, end };
	});
}

/** Resolve a curriculum reading (ref + printed title) to a PDF page range. */
export function resolveRef(spans: readonly SectionSpan[], pages: readonly PageText[], ref: string, title: string): ResolvedRef | null {
	const parsed = parseRef(ref);
	const byNumber = (n: string) => spans.filter((s) => s.number === n);
	const pickByTitle = (cands: SectionSpan[]) =>
		cands.length <= 1 ? cands[0] : [...cands].sort((a, b) => titleSimilarity(b.title, title) - titleSimilarity(a.title, title))[0];

	if (parsed.from) {
		if (parsed.kind === "range" && parsed.to) {
			const a = pickByTitle(byNumber(parsed.from));
			const b = pickByTitle(byNumber(parsed.to));
			if (a && b && b.end >= a.start) return { start: a.start, end: b.end, matched: `${a.title} … ${b.title}`, via: "outline-number" };
		}
		const hit = pickByTitle(byNumber(parsed.from));
		// A bare number that matches a chapter AND a same-numbered page in
		// another part is disambiguated by the title; a weak title match on a
		// numbered hit is still accepted (numbers are the stronger key).
		if (hit) return { start: hit.start, end: hit.end, matched: hit.title, via: "outline-number" };
	}

	// Title-only outline match.
	let best: SectionSpan | null = null;
	let bestScore = 0;
	for (const s of spans) {
		const score = titleSimilarity(s.title, title);
		if (score > bestScore) {
			best = s;
			bestScore = score;
		}
	}
	if (best && bestScore >= 0.6) return { start: best.start, end: best.end, matched: best.title, via: "outline-title" };

	// No usable outline: find the heading line in the page text. An exact
	// title wins; otherwise the number-led heading most like the title (a
	// wrapped heading brings its next line), so another edition's numbering
	// still lands on a retitled-alike section. Contents pages are skipped.
	const words = normalizeWords(title).join(" ");
	if (!words) return null;
	const depth = parsed.kind === "chapter" ? 0 : 1;
	const found = (page: number, line: string): ResolvedRef => ({
		start: page,
		end: findNextHeading(pages, page, depth) ?? Math.min(page + 9, pages.at(-1)?.page ?? page),
		matched: line.trim(),
		via: "text",
	});
	let near: { page: number; line: string; score: number } | null = null;
	for (const p of pages) {
		const lines = p.text.split("\n");
		const contents = lines.filter((l) => /(?:\.\s?){4}/.test(l)).length >= 5;
		for (const [i, line] of lines.entries()) {
			if (line.length > 140) continue;
			const num = leadingNumber(line);
			const lineWords = normalizeWords(line.replace(/^\s*[\d.§]+/, "")).join(" ");
			if (lineWords === words && (!parsed.from || num === parsed.from || num === null)) return found(p.page, line);
			if (contents || num === null || !/^\s*\d+(?:\.\d+)*\s+[A-Z]/.test(line)) continue;
			const rest = line.replace(/^\s*[\d.]+/, "");
			const next = lines[i + 1] ?? "";
			const sim = Math.max(titleSimilarity(rest, title), next.length < 80 ? titleSimilarity(`${rest} ${next}`, title) : 0);
			const ok = sim >= 0.5 || (num === parsed.from && sim >= 0.25);
			const score = sim + (num === parsed.from ? 0.3 : 0);
			if (ok && (!near || score > near.score)) near = { page: p.page, line, score };
		}
	}
	return near ? found(near.page, near.line) : null;
}

/** The page before the next numbered heading at the given depth (0 =
 *  chapter "N Title", 1 = section "N.M Title") after `from`. */
function findNextHeading(pages: readonly PageText[], from: number, depth: number): number | null {
	const re = depth === 0 ? /^\s*(?:chapter\s+)?\d+\s+[A-Z][^.]{2,80}$/ : /^\s*\d+\.\d+\s+[A-Z][^.]{2,80}$/;
	for (const p of pages) {
		if (p.page <= from) continue;
		if (p.text.split("\n").some((l) => re.test(l))) return Math.max(from, p.page - 1);
	}
	return null;
}

/** Printed label for a range ("66–80"), falling back to PDF indices. */
export function pageRangeLabel(pages: readonly PageText[], start: number, end: number): string {
	const label = (n: number) => pages.find((p) => p.page === n)?.label ?? String(n);
	return start === end ? label(start) : `${label(start)}–${label(end)}`;
}

/** The deepest section covering each page (for chunk/search labels). */
export function sectionForPage(spans: readonly SectionSpan[], page: number): string | null {
	let best: SectionSpan | null = null;
	for (const s of spans) if (s.start <= page && page <= s.end && (!best || s.level >= best.level)) best = s;
	return best?.title ?? null;
}

/** Split page text into ~`words`-word chunks, each tagged with its page. */
export function chunkPage(text: string, words = 220): string[] {
	const tokens = text.replace(/\s+/g, " ").trim().split(" ");
	if (tokens.length <= words * 1.3) return tokens.join(" ") ? [tokens.join(" ")] : [];
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i += words) out.push(tokens.slice(Math.max(0, i - 20), i + words).join(" "));
	return out;
}

/** Free text → an FTS5 MATCH expression: quoted phrases kept, other words
 *  OR-ed (bm25 ranks documents matching more terms higher). */
export function ftsQuery(q: string): string | null {
	const phrases = [...q.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.replace(/"/g, "").trim()).filter(Boolean);
	const rest = q.replace(/"[^"]*"/g, " ");
	const terms = normalizeWords(rest).filter((w) => w.length > 1);
	const parts = [...phrases.map((p) => `"${p}"`), ...terms.map((t) => `"${t}"`)];
	return parts.length ? parts.join(" OR ") : null;
}
