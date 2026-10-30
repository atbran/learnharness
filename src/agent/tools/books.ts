import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { pageRangeLabel, resolveRef } from "../../core/bookshelf.ts";
import type { BookshelfStore } from "../../core/ports.ts";

/**
 * The bookshelf tools — cheap, bounded access to the learner's textbooks
 * (pre-indexed at ingest: SQLite FTS5 over ~220-word chunks + the PDF
 * outline). Every result is capped: a search costs a few hundred tokens,
 * a read at most ~6k characters. The lesson brief already names the
 * assigned sections, so book_lookup → book_read is the usual path and
 * blind searching is the exception.
 *
 * Tool contract (the web.ts law): never throw into the agent loop — every
 * failure is a clear string the model can adapt to.
 */

export interface BookToolContext {
	bookshelf: BookshelfStore;
	/** The assigned readings of a curriculum lesson (bookId + ref + title). */
	lessonReadings?: (lessonId: string) => { bookId: string; ref: string; title: string }[] | null;
	/** Render one PDF page to PNG (cached). Absent = no page-image tool. */
	renderPage?: (bookId: string, page: number) => Promise<Buffer | null>;
}

const MAX_READ_CHARS = 6000;

const lookupInput = Type.Object({
	lessonId: Type.Optional(Type.String({ description: "A curriculum lesson id — returns all of its assigned readings." })),
	bookId: Type.Optional(Type.String({ description: "Book id (with ref) — when not using lessonId." })),
	ref: Type.Optional(Type.String({ description: 'Section reference as printed, e.g. "§2.3", "Ch. 4", "4.2-4.4".' })),
	title: Type.Optional(Type.String({ description: "The section's printed title (improves matching)." })),
});

const searchInput = Type.Object({
	query: Type.String({ description: 'Keywords; quote exact phrases, e.g. "method of images" grounded conductor.' }),
	books: Type.Optional(Type.Array(Type.String(), { description: "Restrict to these book ids (default: all ingested)." })),
	k: Type.Optional(Type.Integer({ minimum: 1, maximum: 8, description: "Number of hits (default 5)." })),
});

const readInput = Type.Object({
	bookId: Type.String(),
	from: Type.Integer({ minimum: 1, description: "First PDF page index (as returned by book_lookup/book_search)." }),
	to: Type.Optional(Type.Integer({ minimum: 1, description: "Last PDF page index (default: from)." })),
	maxChars: Type.Optional(Type.Integer({ minimum: 500, maximum: MAX_READ_CHARS, description: `Character cap (default 3500, max ${MAX_READ_CHARS}).` })),
});

const imageInput = Type.Object({
	bookId: Type.String(),
	page: Type.Integer({ minimum: 1, description: "PDF page index." }),
});

function shelfList(bookshelf: BookshelfStore): string {
	const books = bookshelf.listBooks();
	return books.length ? books.map((b) => `${b.bookId} (${b.title}, ${b.pageCount} pp.)`).join("; ") : "none";
}

export function bookTools(ctx: BookToolContext): Record<string, AgentTool<any>> {
	const { bookshelf } = ctx;
	const tools: Record<string, AgentTool<any>> = {
		book_lookup: {
			name: "book_lookup",
			label: "book_lookup",
			description:
				"Find where a section is in the learner's textbook: give a lessonId (all its assigned readings) or bookId + ref (+ title). " +
				"Returns PDF page ranges with printed page numbers and the first lines of each section. Use book_read to read pages.",
			parameters: lookupInput,
			execute: serverExecute("book_lookup", lookupInput, async (input): Promise<string> => {
				const wanted = input.lessonId
					? ctx.lessonReadings?.(input.lessonId) ?? null
					: input.bookId && input.ref
						? [{ bookId: input.bookId, ref: input.ref, title: input.title ?? "" }]
						: null;
				if (!wanted) return input.lessonId ? `Unknown lesson "${input.lessonId}".` : "Give lessonId, or bookId and ref.";
				if (wanted.length === 0) return "This lesson has no assigned readings.";
				const out: string[] = [];
				for (const w of wanted) {
					const book = bookshelf.getBook(w.bookId);
					if (!book) {
						out.push(`- ${w.bookId} ${w.ref} ${w.title}: book not on the shelf (ingested: ${shelfList(bookshelf)}).`);
						continue;
					}
					const pages = bookshelf.allPages(w.bookId);
					const r = resolveRef(bookshelf.spans(w.bookId), pages, w.ref, w.title);
					if (!r) {
						out.push(`- ${w.bookId} ${w.ref} ${w.title}: section not found in the outline; try book_search.`);
						continue;
					}
					const first = pages.find((p) => p.page === r.start)?.text.replace(/\s+/g, " ").slice(0, 300) ?? "";
					out.push(
						`- ${w.bookId} ${w.ref} "${r.matched}": PDF pages ${r.start}–${r.end} (printed ${pageRangeLabel(pages, r.start, r.end)}). Opens: "${first}…"`,
					);
				}
				return out.join("\n");
			}),
		},
		book_search: {
			name: "book_search",
			label: "book_search",
			description:
				"Full-text search over the learner's ingested textbooks. Returns ranked snippets («matches» highlighted) with book id, section, and PDF page (printed page in parentheses). " +
				`Ingested now: ${shelfList(bookshelf)}.`,
			parameters: searchInput,
			execute: serverExecute("book_search", searchInput, async (input): Promise<string> => {
				if (bookshelf.listBooks().length === 0) return "No textbooks are ingested yet.";
				const hits = bookshelf.search(input.query, { bookIds: input.books, k: input.k ?? 5 });
				if (hits.length === 0) return `No matches for "${input.query}". Try fewer or different keywords.`;
				return hits
					.map((h, i) => `${i + 1}. [${h.bookId} p.${h.page}${h.label ? ` (printed ${h.label})` : ""}${h.section ? ` · ${h.section}` : ""}] ${h.snippet}`)
					.join("\n");
			}),
		},
		book_read: {
			name: "book_read",
			label: "book_read",
			description:
				"Read the extracted text of textbook pages (PDF page indices). Capped; read only the pages you need. " +
				"Equations in extracted text can be garbled — if a page's math is unreadable, use book_page_image on that one page.",
			parameters: readInput,
			execute: serverExecute("book_read", readInput, async (input): Promise<string> => {
				const book = bookshelf.getBook(input.bookId);
				if (!book) return `Book "${input.bookId}" is not ingested (ingested: ${shelfList(bookshelf)}).`;
				const to = Math.min(input.to ?? input.from, input.from + 14, book.pageCount);
				const cap = input.maxChars ?? 3500;
				let out = "";
				for (const p of bookshelf.pages(input.bookId, input.from, to)) {
					const chunk = `--- p.${p.page}${p.label ? ` (printed ${p.label})` : ""} ---\n${p.text.trim()}\n`;
					if (out.length + chunk.length > cap) {
						out += chunk.slice(0, Math.max(0, cap - out.length));
						out += `\n[truncated at ${cap} chars — continue from p.${p.page} if needed]`;
						return out;
					}
					out += chunk;
				}
				return out || `No text on pages ${input.from}–${to}.`;
			}),
		},
	};
	if (ctx.renderPage) {
		const render = ctx.renderPage;
		tools.book_page_image = {
			name: "book_page_image",
			label: "book_page_image",
			description: "Render ONE textbook page as an image — only for pages whose equations or figures the extracted text garbles.",
			parameters: imageInput,
			execute: serverExecute("book_page_image", imageInput, async (input): Promise<string | ImageFileResult> => {
				const png = await render(input.bookId, input.page);
				if (!png) return `Could not render ${input.bookId} p.${input.page}.`;
				return { text: `${input.bookId} p.${input.page}`, images: [{ data: png.toString("base64"), mimeType: "image/png" }] };
			}),
		};
	}
	return tools;
}
