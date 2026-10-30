/**
 * The bookshelf's server seam: PDF ingest (deterministic, no LLM —
 * pdfjs text + outline → SQLite FTS), reading-ref resolution for the
 * curriculum, catalog matching, and page rendering for the reader.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { pageRangeLabel, resolveRef, sectionSpans, titleSimilarity, type ResolvedRef } from "../core/bookshelf.ts";
import type { Lesson } from "../core/contracts/curriculum.ts";
import { emit } from "../core/events.ts";
import { pdfBookExtract } from "../agent/subagents/pdf-ops.ts";
import { getHeadless } from "../agent/subagents/headless.ts";
import type { BookToolContext } from "../agent/tools/books.ts";
import { programIndex, setReadingResolver, type ResolvedReading } from "./curriculum.ts";
import { stores } from "./stores.ts";

// ─── Ingest registry (process-global: route modules don't share state) ──────

export interface IngestStatus {
	bookId: string;
	status: "running" | "done" | "error";
	done: number;
	total: number;
	error?: string;
	startedAt: string;
}

const g = globalThis as unknown as { __lhBookIngest?: Map<string, IngestStatus> };
const ingests = (g.__lhBookIngest ??= new Map());

export function ingestStatuses(): IngestStatus[] {
	return [...ingests.values()];
}

/** Move `pdfFile` into the shelf as `bookId` and index it (async; poll
 *  ingestStatuses or listen for curriculum-changed). */
export function startIngest(bookId: string, pdfFile: string, sourceName: string): void {
	if (ingests.get(bookId)?.status === "running") throw new Error(`${bookId} is already being ingested`);
	const target = stores.bookshelfStore.sourcePath(bookId);
	if (path.resolve(pdfFile) !== path.resolve(target)) {
		fs.copyFileSync(pdfFile, target);
	}
	const status: IngestStatus = { bookId, status: "running", done: 0, total: 0, startedAt: new Date().toISOString() };
	ingests.set(bookId, status);
	emit("curriculum-changed", {});
	let lastEmit = 0;
	// One ingest at a time: a whole-book pdfjs pass holds the PDF in memory,
	// and an inbox scan can queue twenty of them.
	queue.tail = queue.tail.then(() => runIngest());
	const runIngest = async () => {
		try {
			const extract = await pdfBookExtract(target, (done, total) => {
				status.done = done;
				status.total = total;
				if (Date.now() - lastEmit > 1500) {
					lastEmit = Date.now();
					emit("curriculum-changed", {});
				}
			});
			const catalog = stores.curriculumStore.loadCatalog().books.find((b) => b.id === bookId);
			stores.bookshelfStore.writeIndex(bookId, {
				title: catalog?.title ?? extract.meta.title ?? sourceName.replace(/\.pdf$/i, ""),
				sourceName,
				pages: extract.pages,
				spans: sectionSpans(extract.outline, extract.pageCount),
				outlineEntries: extract.outline.length,
			});
			resolutionCache.clear();
			status.status = "done";
		} catch (err) {
			status.status = "error";
			status.error = err instanceof Error ? err.message : String(err);
		} finally {
			emit("curriculum-changed", {});
		}
	};
}

const gq = globalThis as unknown as { __lhIngestQueue?: { tail: Promise<void> } };
const queue = (gq.__lhIngestQueue ??= { tail: Promise.resolve() });

/** Guess which catalog book a PDF is, from its metadata title and the
 *  text of its first pages. */
export async function matchCatalogBook(pdfFile: string): Promise<{ bookId: string; score: number } | null> {
	// The title pages are enough to recognise a book; never extract it all.
	const extract = await pdfBookExtract(pdfFile, undefined, { maxPages: 8 });
	// The file name rides along: scanned PDFs have no text layer at all.
	const fileName = path.basename(pdfFile).replace(/[_-]+/g, " ");
	const head = `${fileName} ${extract.meta.title ?? ""} ${extract.meta.author ?? ""} ${extract.pages.slice(0, 6).map((p) => p.text).join(" ")}`.toLowerCase();
	// The title page outweighs the rest: lecture notes cite other books
	// (Tong's Classical Dynamics names Goldstein) in their opening pages.
	const titlePage = `${fileName} ${extract.meta.title ?? ""} ${extract.pages[0]?.text ?? ""}`.toLowerCase();
	let best: { bookId: string; score: number } | null = null;
	for (const b of stores.curriculumStore.loadCatalog().books) {
		const hints = b.matchHints.length ? b.matchHints : [b.title.toLowerCase()];
		const hit = (text: string) => hints.filter((h) => text.includes(h.toLowerCase())).length / hints.length;
		const titleScore = extract.meta.title ? titleSimilarity(extract.meta.title, b.title) : 0;
		const authorScore = b.authors.some((a) => head.includes(a.split(" ").at(-1)!.toLowerCase())) ? 0.3 : 0;
		const score = Math.max(hit(head), titleScore) + authorScore + 0.5 * hit(titlePage);
		if (!best || score > best.score) best = { bookId: b.id, score };
	}
	return best && best.score >= 0.8 ? best : null;
}

/** Ingest every PDF dropped in data/books/inbox/ that matches a catalog book. */
export async function scanInbox(): Promise<{ file: string; bookId: string | null }[]> {
	const inbox = path.join(PATHS.books, "inbox");
	fs.mkdirSync(inbox, { recursive: true });
	const out: { file: string; bookId: string | null }[] = [];
	for (const f of fs.readdirSync(inbox).filter((n) => n.toLowerCase().endsWith(".pdf"))) {
		const full = path.join(inbox, f);
		const match = await matchCatalogBook(full).catch(() => null);
		out.push({ file: f, bookId: match?.bookId ?? null });
		if (match && ingests.get(match.bookId)?.status !== "running") startIngest(match.bookId, full, f);
	}
	return out;
}

// ─── Reading resolution (registered into the curriculum seam) ───────────────

const resolutionCache = new Map<string, ResolvedRef | null>();

function resolveOne(bookId: string, ref: string, title: string): { r: ResolvedRef; pages: string } | null {
	const book = stores.bookshelfStore.getBook(bookId);
	if (!book) return null;
	const key = `${bookId}|${book.ingestedAt}|${ref}|${title}`;
	let r = resolutionCache.get(key);
	const all = stores.bookshelfStore.allPages(bookId);
	if (r === undefined) {
		r = resolveRef(stores.bookshelfStore.spans(bookId), all, ref, title);
		resolutionCache.set(key, r);
	}
	return r ? { r, pages: pageRangeLabel(all, r.start, r.end) } : null;
}

export function resolveLessonReadings(lesson: Lesson): ResolvedReading[] {
	const catalog = stores.curriculumStore.loadCatalog();
	return lesson.readings.map((reading) => {
		const book = catalog.books.find((b) => b.id === reading.bookId);
		const base = {
			bookId: reading.bookId,
			label: `${book?.title ?? reading.bookId} ${reading.ref} ${reading.title}`,
			ref: reading.ref,
			title: reading.title,
			optional: !!reading.optional,
		};
		const hit = resolveOne(reading.bookId, reading.ref, reading.title);
		if (!stores.bookshelfStore.getBook(reading.bookId)) return { ...base, ingested: false };
		return hit ? { ...base, ingested: true, pages: hit.pages, pdfPages: [hit.r.start, hit.r.end] as [number, number] } : { ...base, ingested: true };
	});
}

setReadingResolver(resolveLessonReadings);

// ─── Views ──────────────────────────────────────────────────────────────────

export function bookshelfView() {
	const catalog = stores.curriculumStore.loadCatalog();
	const ingested = new Map(stores.bookshelfStore.listBooks().map((b) => [b.bookId, b]));
	const index = programIndex();
	const refsByBook = new Map<string, { lessonId: string; ref: string; title: string }[]>();
	for (const id of index.lessonOrder) {
		for (const r of index.lessons.get(id)!.lesson.readings) {
			const list = refsByBook.get(r.bookId) ?? [];
			list.push({ lessonId: id, ref: r.ref, title: r.title });
			refsByBook.set(r.bookId, list);
		}
	}
	return {
		books: catalog.books.map((b) => {
			const refs = refsByBook.get(b.id) ?? [];
			const book = ingested.get(b.id) ?? null;
			const unresolved = book ? refs.filter((r) => !resolveOne(b.id, r.ref, r.title)) : [];
			return {
				...b,
				ingested: book,
				ingest: ingests.get(b.id) ?? null,
				refCount: refs.length,
				lessonCount: new Set(refs.map((r) => r.lessonId)).size,
				unresolved: unresolved.slice(0, 50),
				unresolvedCount: unresolved.length,
			};
		}),
	};
}

/** A rendered page PNG (cached on disk). */
export async function renderBookPage(bookId: string, page: number, dpi = 110): Promise<Buffer | null> {
	const book = stores.bookshelfStore.getBook(bookId);
	if (!book || page < 1 || page > book.pageCount) return null;
	const cache = stores.bookshelfStore.pageImagePath(bookId, page, dpi);
	if (fs.existsSync(cache)) return fs.readFileSync(cache);
	const [rendered] = await getHeadless().renderPdfPages(stores.bookshelfStore.sourcePath(bookId), [page], { dpi });
	if (!rendered) return null;
	fs.writeFileSync(cache, rendered.png);
	return rendered.png;
}

/** The agent book tools' context (chat-handler composes it per turn). */
export function bookToolContext(): BookToolContext {
	return {
		bookshelf: stores.bookshelfStore,
		lessonReadings: (lessonId) => programIndex().lessons.get(lessonId)?.lesson.readings.map((r) => ({ bookId: r.bookId, ref: r.ref, title: r.title })) ?? null,
		renderPage: (bookId, page) => renderBookPage(bookId, page, 150),
	};
}
