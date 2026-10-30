import * as fs from "node:fs";
import { Readable } from "node:stream";
import { explainerVideoPath, parseRange } from "@/src/server";

/** The demo's Manim explainer MP4, Range-capable (206) so the player can seek. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ lessonId: string; i: string }> }) {
	const { lessonId, i } = await params;
	const file = explainerVideoPath(lessonId, Number(i));
	if (!file) return new Response("not found", { status: 404 });
	const { size, mtime } = fs.statSync(file);
	const headers: Record<string, string> = {
		"Content-Type": "video/mp4",
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, no-cache",
		"Last-Modified": mtime.toUTCString(),
	};
	const range = parseRange(req.headers.get("range"), size);
	if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
	const { start, end } = range ?? { start: 0, end: size - 1 };
	const body = size === 0 ? null : (Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>);
	return new Response(body, {
		status: range ? 206 : 200,
		headers: { ...headers, "Content-Length": String(size === 0 ? 0 : end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) },
	});
}
