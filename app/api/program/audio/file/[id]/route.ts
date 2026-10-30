import * as fs from "node:fs";
import { Readable } from "node:stream";
import { audioFilePath, parseRange } from "@/src/server";

/** The guide's OGG, Range-capable (206) so players can seek; `?download=1`
 *  serves it as an attachment (save to phone). */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const file = audioFilePath(id.replace(/\.ogg$/, ""));
	if (!file) return new Response("not found", { status: 404 });
	const { size, mtime } = fs.statSync(file);
	const url = new URL(req.url);
	const headers: Record<string, string> = {
		"Content-Type": "audio/ogg",
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, no-cache",
		"Last-Modified": mtime.toUTCString(),
	};
	if (url.searchParams.has("download")) {
		const name = (url.searchParams.get("name") || id).replace(/[^\w .-]+/g, "").trim().slice(0, 120) || "audio-guide";
		headers["Content-Disposition"] = `attachment; filename="${name}.ogg"`;
	}
	const range = parseRange(req.headers.get("range"), size);
	if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
	const { start, end } = range ?? { start: 0, end: size - 1 };
	const body = size === 0 ? null : (Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>);
	return new Response(body, {
		status: range ? 206 : 200,
		headers: { ...headers, "Content-Length": String(size === 0 ? 0 : end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) },
	});
}
