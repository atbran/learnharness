import * as fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { startIngest, stores } from "@/src/server";

/** Upload a textbook PDF for a catalog book (raw body, streamed to disk),
 *  then index it in the background. ?bookId=<catalog id>&name=<file name> */
export async function POST(req: Request) {
	const url = new URL(req.url);
	const bookId = url.searchParams.get("bookId") ?? "";
	const name = (url.searchParams.get("name") ?? "book.pdf").slice(0, 200);
	if (!stores.curriculumStore.loadCatalog().books.some((b) => b.id === bookId)) return Response.json({ error: "unknown book" }, { status: 400 });
	if (!req.body) return Response.json({ error: "empty body" }, { status: 400 });
	const target = stores.bookshelfStore.sourcePath(bookId);
	const tmp = `${target}.upload`;
	await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), fs.createWriteStream(tmp));
	const head = Buffer.alloc(5);
	const fd = fs.openSync(tmp, "r");
	fs.readSync(fd, head, 0, 5, 0);
	fs.closeSync(fd);
	if (head.toString("latin1") !== "%PDF-") {
		fs.rmSync(tmp, { force: true });
		return Response.json({ error: "not a PDF" }, { status: 400 });
	}
	fs.renameSync(tmp, target);
	try {
		startIngest(bookId, target, name);
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
	}
	return Response.json({ ok: true });
}
