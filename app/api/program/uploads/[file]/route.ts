import * as fs from "node:fs";
import { uploadPath } from "@/src/server";

/** Serve an uploaded photo of handwritten work (thumbnails in the UI). */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
	const { file } = await params;
	const p = uploadPath(file);
	if (!p) return new Response("not found", { status: 404 });
	const type = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
	return new Response(new Uint8Array(fs.readFileSync(p)), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" } });
}
