/**
 * The bookshelf from the command line — the same SQLite index the app's
 * tutor uses, for Claude Code or any shell. Output is compact by design
 * (a search costs a few hundred tokens).
 *
 *   npx tsx scripts/books.ts list
 *   npx tsx scripts/books.ts search "method of images" [--book griffiths-em] [-k 5]
 *   npx tsx scripts/books.ts lookup <lessonId>            # assigned readings → pages
 *   npx tsx scripts/books.ts section <bookId> "§2.3" ["Electric Potential"]
 *   npx tsx scripts/books.ts read <bookId> <fromPage> [toPage] [--max 4000]
 *   npx tsx scripts/books.ts toc <bookId> [--depth 1]
 *   npx tsx scripts/books.ts ingest <bookId> <file.pdf>
 *
 * LH_DATA_DIR selects the data folder (default: the repo's data/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { bookshelfStore as shelf } from "../src/store/bookshelf.ts";
import { curriculumStore } from "../src/store/curriculum.ts";
import { pageRangeLabel, resolveRef, sectionSpans } from "../src/core/bookshelf.ts";
import { indexProgram } from "../src/core/curriculum.ts";
import { pdfBookExtract } from "../src/agent/subagents/pdf-ops.ts";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
	const i = rest.indexOf(name);
	if (i < 0) return fallback;
	const v = rest[i + 1];
	rest.splice(i, 2);
	return v;
};

function section(bookId: string, ref: string, title: string): string {
	const pages = shelf.allPages(bookId);
	const r = resolveRef(shelf.spans(bookId), pages, ref, title);
	return r ? `${bookId} ${ref}: pdf pp. ${r.start}-${r.end} (printed ${pageRangeLabel(pages, r.start, r.end)}) "${r.matched}"` : `${bookId} ${ref} ${title}: not found`;
}

switch (cmd) {
	case "list":
		for (const b of shelf.listBooks()) console.log(`${b.bookId}\t${b.pageCount} pp.\t${b.title}`);
		break;
	case "search": {
		const book = flag("--book");
		const k = Number(flag("-k", "5"));
		for (const h of shelf.search(rest.join(" "), { bookIds: book ? [book] : undefined, k }))
			console.log(`[${h.bookId} p.${h.page}${h.label ? `/${h.label}` : ""}${h.section ? ` · ${h.section}` : ""}] ${h.snippet}`);
		break;
	}
	case "lookup": {
		const ref = indexProgram(curriculumStore.loadProgram()).lessons.get(rest[0] ?? "");
		if (!ref) throw new Error(`unknown lesson ${rest[0]}`);
		for (const r of ref.lesson.readings) console.log(shelf.getBook(r.bookId) ? section(r.bookId, r.ref, r.title) : `${r.bookId} ${r.ref} ${r.title}: book not ingested`);
		break;
	}
	case "section":
		console.log(section(rest[0]!, rest[1]!, rest[2] ?? ""));
		break;
	case "read": {
		const max = Number(flag("--max", "4000"));
		const from = Number(rest[1]);
		const to = Number(rest[2] ?? from);
		let out = "";
		for (const p of shelf.pages(rest[0]!, from, to)) out += `--- p.${p.page}${p.label ? ` (printed ${p.label})` : ""} ---\n${p.text.trim()}\n`;
		console.log(out.length > max ? `${out.slice(0, max)}\n[truncated at ${max} chars]` : out);
		break;
	}
	case "toc": {
		const depth = Number(flag("--depth", "1"));
		for (const s of shelf.spans(rest[0]!)) if (s.level <= depth) console.log(`${"  ".repeat(s.level)}${s.title}  (pp. ${s.start}-${s.end})`);
		break;
	}
	case "ingest": {
		const [bookId, file] = rest as [string, string];
		const target = shelf.sourcePath(bookId);
		if (path.resolve(file) !== path.resolve(target)) fs.copyFileSync(file, target);
		const extract = await pdfBookExtract(target, (d, t) => d % 50 === 0 && process.stderr.write(`\r${d}/${t}`));
		const title = curriculumStore.loadCatalog().books.find((b) => b.id === bookId)?.title ?? extract.meta.title ?? bookId;
		shelf.writeIndex(bookId, { title, sourceName: path.basename(file), pages: extract.pages, spans: sectionSpans(extract.outline, extract.pageCount), outlineEntries: extract.outline.length });
		console.log(`\ningested ${bookId}: ${extract.pageCount} pages, ${extract.outline.length} outline entries`);
		break;
	}
	default:
		console.log("commands: list | search | lookup | section | read | toc | ingest  (see the header of scripts/books.ts)");
}
