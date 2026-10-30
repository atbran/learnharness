/**
 * BookshelfStore — node:sqlite adapter (implements core/ports.ts
 * BookshelfStore). Layout per book:
 *
 *   data/books/<bookId>/source.pdf      the learner's PDF (copied in)
 *   data/books/<bookId>/index.sqlite    meta · pages · spans · chunks (FTS5)
 *   data/books/<bookId>/pages/<n>@<dpi>.png   rendered-page cache
 *
 * The index is rebuilt whole on (re-)ingest. Reads open the file per call:
 * cheap for SQLite, and no long-lived handle blocks a re-ingest rename on
 * Windows.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PATHS } from "../../config.ts";
import { chunkPage, ftsQuery, sectionForPage, type PageText, type SectionSpan } from "../core/bookshelf.ts";
import { emit } from "../core/events.ts";
import type { BookSearchHit, BookshelfStore, IngestedBook } from "../core/ports.ts";

const SAFE = /^[a-z0-9][a-z0-9-]*$/;

function dir(bookId: string): string {
	if (!SAFE.test(bookId)) throw new Error(`invalid book id: ${bookId}`);
	return path.join(PATHS.books, bookId);
}

function dbPath(bookId: string): string {
	return path.join(dir(bookId), "index.sqlite");
}

function withDb<T>(bookId: string, fallback: T, fn: (db: DatabaseSync) => T): T {
	const file = dbPath(bookId);
	if (!fs.existsSync(file)) return fallback;
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

function getBook(bookId: string): IngestedBook | null {
	return withDb(bookId, null as IngestedBook | null, (db) => {
		const rows = db.prepare("SELECT key, value FROM meta").all() as unknown as { key: string; value: string }[];
		const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
		return {
			bookId,
			title: m.title ?? bookId,
			pageCount: Number(m.pageCount ?? 0),
			ingestedAt: m.ingestedAt ?? "",
			sourceName: m.sourceName ?? "",
			outlineEntries: Number(m.outlineEntries ?? 0),
		};
	});
}

function listBooks(): IngestedBook[] {
	let ids: string[] = [];
	try {
		ids = fs.readdirSync(PATHS.books).filter((d) => SAFE.test(d) && fs.existsSync(dbPath(d)));
	} catch {
		return [];
	}
	return ids.map(getBook).filter((b): b is IngestedBook => b !== null);
}

function writeIndex(
	bookId: string,
	input: { title: string; sourceName: string; pages: PageText[]; spans: SectionSpan[]; outlineEntries: number },
): void {
	fs.mkdirSync(dir(bookId), { recursive: true });
	const tmp = `${dbPath(bookId)}.building`;
	fs.rmSync(tmp, { force: true });
	const db = new DatabaseSync(tmp);
	try {
		db.exec(`
			CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
			CREATE TABLE pages (page INTEGER PRIMARY KEY, label TEXT, text TEXT NOT NULL);
			CREATE TABLE spans (idx INTEGER PRIMARY KEY, title TEXT, level INTEGER, number TEXT, start INTEGER, end INTEGER);
			CREATE VIRTUAL TABLE chunks USING fts5(text, section UNINDEXED, page UNINDEXED, tokenize = 'porter unicode61');
		`);
		db.exec("BEGIN");
		const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
		meta.run("title", input.title);
		meta.run("pageCount", String(input.pages.length));
		meta.run("ingestedAt", new Date().toISOString());
		meta.run("sourceName", input.sourceName);
		meta.run("outlineEntries", String(input.outlineEntries));
		const page = db.prepare("INSERT INTO pages VALUES (?, ?, ?)");
		const chunk = db.prepare("INSERT INTO chunks (text, section, page) VALUES (?, ?, ?)");
		for (const p of input.pages) {
			page.run(p.page, p.label, p.text);
			const section = sectionForPage(input.spans, p.page);
			for (const c of chunkPage(p.text)) chunk.run(c, section, p.page);
		}
		const span = db.prepare("INSERT INTO spans VALUES (?, ?, ?, ?, ?, ?)");
		input.spans.forEach((s, i) => span.run(i, s.title, s.level, s.number, s.start, s.end));
		db.exec("COMMIT");
	} finally {
		db.close();
	}
	fs.rmSync(dbPath(bookId), { force: true });
	fs.renameSync(tmp, dbPath(bookId));
	allPagesCache.delete(bookId);
	emit("curriculum-changed", {});
}

function search(query: string, opts: { bookIds?: string[]; k?: number } = {}): BookSearchHit[] {
	const match = ftsQuery(query);
	if (!match) return [];
	const k = Math.max(1, Math.min(opts.k ?? 6, 12));
	const ids = opts.bookIds?.length ? opts.bookIds : listBooks().map((b) => b.bookId);
	const hits: BookSearchHit[] = [];
	for (const bookId of ids) {
		if (!SAFE.test(bookId)) continue;
		withDb(bookId, null, (db) => {
			const rows = db
				.prepare(
					`SELECT c.page AS page, c.section AS section, p.label AS label,
					        snippet(chunks, 0, '«', '»', ' … ', 40) AS snippet, bm25(chunks) AS score
					 FROM chunks c JOIN pages p ON p.page = c.page
					 WHERE chunks MATCH ? ORDER BY score LIMIT ?`,
				)
				.all(match, k * 3) as unknown as Omit<BookSearchHit, "bookId">[];
			for (const r of rows) hits.push({ bookId, ...r });
			return null;
		});
	}
	// Best chunk per (book, page): adjacent chunks of one page would
	// otherwise crowd out other pages.
	const seen = new Set<string>();
	return hits
		.sort((a, b) => a.score - b.score)
		.filter((h) => {
			const key = `${h.bookId}:${h.page}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, k);
}

function pages(bookId: string, from: number, to: number): PageText[] {
	return withDb(bookId, [] as PageText[], (db) =>
		db.prepare("SELECT page, label, text FROM pages WHERE page BETWEEN ? AND ? ORDER BY page").all(from, to) as unknown as PageText[],
	);
}

const allPagesCache = new Map<string, { at: string; pages: PageText[] }>();
function allPages(bookId: string): PageText[] {
	const book = getBook(bookId);
	if (!book) return [];
	const hit = allPagesCache.get(bookId);
	if (hit && hit.at === book.ingestedAt) return hit.pages;
	const all = pages(bookId, 1, 1_000_000);
	allPagesCache.set(bookId, { at: book.ingestedAt, pages: all });
	return all;
}

function spans(bookId: string): SectionSpan[] {
	return withDb(bookId, [] as SectionSpan[], (db) =>
		db.prepare("SELECT title, level, number, start, end FROM spans ORDER BY idx").all() as unknown as SectionSpan[],
	);
}

function sourcePath(bookId: string): string {
	fs.mkdirSync(dir(bookId), { recursive: true });
	return path.join(dir(bookId), "source.pdf");
}

function pageImagePath(bookId: string, page: number, dpi: number): string {
	const d = path.join(dir(bookId), "pages");
	fs.mkdirSync(d, { recursive: true });
	return path.join(d, `${Math.trunc(page)}@${Math.trunc(dpi)}.png`);
}

export const bookshelfStore: BookshelfStore = {
	listBooks,
	getBook,
	writeIndex,
	sourcePath,
	search,
	pages,
	allPages,
	spans,
	pageImagePath,
};
