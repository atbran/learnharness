import { addExplanation, listNotebook, removeExplanation } from "@/src/server";

/** The teach-back notebook. GET: the entries. POST {lessonId, text}: save an
 *  explanation and return it with brief feedback. DELETE ?id: remove one. */
export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ entries: listNotebook() });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { lessonId?: unknown; text?: unknown };
	try {
		return Response.json(await addExplanation(String(body.lessonId ?? ""), typeof body.text === "string" ? body.text : ""));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}

export async function DELETE(req: Request) {
	removeExplanation(new URL(req.url).searchParams.get("id") ?? "");
	return Response.json({ ok: true });
}
