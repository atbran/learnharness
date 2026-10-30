import { ensureLessonNotes, notesView } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET — the lesson's notes (or writing/missing/error). */
export async function GET(_req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const view = notesView(lessonId);
	return view ? Response.json(view) : Response.json({ error: "unknown lesson" }, { status: 404 });
}

/** POST { fresh? } — write the notes now (background). */
export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const body = (await req.json().catch(() => ({}))) as { fresh?: unknown };
	if (!notesView(lessonId)) return Response.json({ error: "unknown lesson" }, { status: 404 });
	void ensureLessonNotes(lessonId, { fresh: body.fresh === true });
	return Response.json(notesView(lessonId));
}
