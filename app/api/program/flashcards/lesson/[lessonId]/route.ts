import { ensureFlashcards, lessonCardsStatus } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET — whether the lesson's generated deck exists (ready/writing/missing/error). */
export async function GET(_req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const status = lessonCardsStatus(lessonId);
	return status ? Response.json(status) : Response.json({ error: "unknown lesson" }, { status: 404 });
}

/** POST — write the lesson's deck now (background). */
export async function POST(_req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	if (!lessonCardsStatus(lessonId)) return Response.json({ error: "unknown lesson" }, { status: 404 });
	void ensureFlashcards(lessonId);
	return Response.json(lessonCardsStatus(lessonId));
}
