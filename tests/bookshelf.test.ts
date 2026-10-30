/**
 * bookshelf — reading-ref resolution against a PDF outline / page text,
 * and the node:sqlite FTS index (write, search, page reads).
 */
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-books-"));
process.env.LH_DATA_DIR = DATA;

const { ftsQuery, leadingNumber, parseRef, resolveRef, sectionSpans, pageRangeLabel } = await import("../src/core/bookshelf.ts");
const { bookshelfStore } = await import("../src/store/bookshelf.ts");

const outline = [
	{ title: "1 Vector Analysis", level: 0, page: 3 },
	{ title: "1.1 Vector Algebra", level: 1, page: 3 },
	{ title: "1.2 Differential Calculus", level: 1, page: 6 },
	{ title: "2 Electrostatics", level: 0, page: 10 },
	{ title: "2.1 The Electric Field", level: 1, page: 10 },
	{ title: "2.2 Divergence and Curl of Electrostatic Fields", level: 1, page: 13 },
	{ title: "2.3 Electric Potential", level: 1, page: 17 },
	{ title: "Appendix A Vector Calculus in Curvilinear Coordinates", level: 0, page: 22 },
];
const pages = Array.from({ length: 24 }, (_, i) => ({
	page: i + 1,
	label: i < 2 ? ["i", "ii"][i]! : String(i - 1),
	text:
		i + 1 === 13
			? "2.2 Divergence and Curl of Electrostatic Fields\nGauss's law relates the electric flux through a closed surface to the enclosed charge."
			: `page ${i + 1} filler text about vectors and fields`,
}));

test("parseRef understands section, chapter, range, appendix", () => {
	assert.deepEqual(parseRef("§2.3"), { kind: "section", from: "2.3", to: null });
	assert.deepEqual(parseRef("Ch. 4"), { kind: "chapter", from: "4", to: null });
	assert.deepEqual(parseRef("4.2-4.4"), { kind: "range", from: "4.2", to: "4.4" });
	assert.deepEqual(parseRef("4.2–4"), { kind: "range", from: "4.2", to: "4.4" });
	assert.deepEqual(parseRef("Appendix A"), { kind: "appendix", from: "A", to: null });
	assert.equal(leadingNumber("Chapter 12 Electrodynamics"), "12");
	assert.equal(leadingNumber("Appendix B The Helmholtz Theorem"), "B");
});

test("outline spans and ref resolution", () => {
	const spans = sectionSpans(outline, 24);
	const ch2 = spans.find((s) => s.number === "2")!;
	assert.deepEqual([ch2.start, ch2.end], [10, 21]);
	assert.deepEqual([spans[1]!.start, spans[1]!.end], [3, 5]);

	const s23 = resolveRef(spans, pages, "§2.3", "Electric Potential")!;
	assert.deepEqual([s23.start, s23.end, s23.via], [17, 21, "outline-number"]);
	const range = resolveRef(spans, pages, "2.1-2.2", "The field and Gauss")!;
	assert.deepEqual([range.start, range.end], [10, 16]);
	const ch = resolveRef(spans, pages, "Ch. 1", "Vector Analysis")!;
	assert.deepEqual([ch.start, ch.end], [3, 9]);
	const byTitle = resolveRef(spans, pages, "§9.9", "Divergence and Curl of Electrostatic Fields")!;
	assert.equal(byTitle.via, "outline-title");
	assert.equal(resolveRef(spans, pages, "§7.1", "Nothing like this"), null);
	assert.equal(pageRangeLabel(pages, 17, 21), "15–19");
});

test("without an outline, the heading line in the page text resolves", () => {
	const r = resolveRef([], pages, "§2.2", "Divergence and Curl of Electrostatic Fields")!;
	assert.equal(r.via, "text");
	assert.equal(r.start, 13);
});

test("without an outline, a wrapped or retitled heading still resolves; contents pages don't", () => {
	const book = [
		{ page: 1, label: "i", text: ["Contents", ...["2.1 Dark night sky", "2.2 Isotropy and homogeneity", "3.2 Describing curvature", "3.4 Proper distance", "4.1 Friedmann equation"].map((l) => `${l} . . . . . . . 7`)].join("\n") },
		{ page: 5, label: "3", text: "2.2 On large scales, the universe is isotropic\nand homogeneous\nObservations show..." },
		{ page: 9, label: "7", text: "3.2 Describing curvature\nIn two dimensions..." },
		{ page: 12, label: "10", text: "3.4 Proper distance\nThe distance..." },
	];
	// Another edition's number (§2.2 → wrapped heading on p5).
	assert.equal(resolveRef([], book, "§2.2", "On Large Scales, the Universe is Isotropic and Homogeneous")!.start, 5);
	// Renumbered: the title outweighs a same-number heading about something else.
	assert.equal(resolveRef([], book, "§3.4", "Describing Curvature")!.start, 9);
	assert.equal(resolveRef([], book, "§5.1", "Nothing like this"), null);

	// Lecture notes: "N. Title" chapters, contents lines ending in page numbers.
	const notes = [
		{ page: 1, label: "1", text: ["1 Newton's Laws 1", "1.1 Introduction 1", "2 The Lagrangian Formalism 10", "2.1 The Principle of Least Action 10", "3 Rigid Bodies 46"].join("\n") },
		{ page: 12, label: "10", text: "2. The Lagrangian Formalism\nWhen I was in high school..." },
		{ page: 48, label: "46", text: "3. The Motion of Rigid Bodies\nUp until now..." },
	];
	const ch2 = resolveRef([], notes, "Ch. 2", "The Lagrangian Formulation")!;
	assert.deepEqual([ch2.start, ch2.end], [12, 47]);
});

test("ftsQuery quotes terms and keeps phrases", () => {
	assert.equal(ftsQuery('the "electric flux" through surface'), '"electric flux" OR "through" OR "surface"');
	assert.equal(ftsQuery("the of"), null);
});

test("sqlite index: write, search with snippets, read pages", () => {
	bookshelfStore.writeIndex("griffiths-em", {
		title: "Introduction to Electrodynamics",
		sourceName: "griffiths.pdf",
		pages,
		spans: sectionSpans(outline, 24),
		outlineEntries: outline.length,
	});
	const book = bookshelfStore.getBook("griffiths-em")!;
	assert.equal(book.pageCount, 24);
	assert.deepEqual(bookshelfStore.listBooks().map((b) => b.bookId), ["griffiths-em"]);
	const hits = bookshelfStore.search("Gauss law flux enclosed charge");
	assert.equal(hits[0]!.page, 13);
	assert.equal(hits[0]!.label, "11");
	assert.equal(hits[0]!.section, "2.2 Divergence and Curl of Electrostatic Fields");
	assert.match(hits[0]!.snippet, /«flux»/);
	assert.deepEqual(bookshelfStore.pages("griffiths-em", 12, 13).map((p) => p.page), [12, 13]);
	assert.equal(bookshelfStore.spans("griffiths-em").length, outline.length);
});
