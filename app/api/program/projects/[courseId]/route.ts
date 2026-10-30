import { programIndex, recordProgress } from "@/src/server";

/** POST: mark a course's optional capstone project done (a ledger event;
 *  off the lesson path, so nothing else in progress changes). */
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ courseId: string }> }) {
	const { courseId } = await params;
	if (!programIndex().courses.get(courseId)?.project) return Response.json({ error: "no such project" }, { status: 404 });
	recordProgress({ type: "project_done", at: new Date().toISOString(), courseId });
	return Response.json({ ok: true });
}
