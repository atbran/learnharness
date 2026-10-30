import { addUpload, removeUpload } from "@/src/server";

/** POST raw image body ?problem=<id>: attach a photo of handwritten work.
 *  DELETE ?problem=<id>&file=<name>: detach one. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const problem = new URL(req.url).searchParams.get("problem") ?? "";
	const bytes = new Uint8Array(await req.arrayBuffer());
	if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) return Response.json({ error: "image must be 1 byte–25 MB" }, { status: 400 });
	try {
		const file = await addUpload(id, problem, bytes, req.headers.get("content-type") ?? "image/jpeg");
		return Response.json({ file });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const url = new URL(req.url);
	try {
		removeUpload(id, url.searchParams.get("problem") ?? "", url.searchParams.get("file") ?? "");
		return Response.json({ ok: true });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
