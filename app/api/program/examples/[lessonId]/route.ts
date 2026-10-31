import { ensureWorkedExamples, examplesView } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET — the lesson's worked examples (or writing/missing/error). */
export async function GET(_req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const view = examplesView(lessonId);
	return view ? Response.json(view) : Response.json({ error: "unknown lesson" }, { status: 404 });
}

/** POST { fresh? } — write the examples now (background). */
export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const body = (await req.json().catch(() => ({}))) as { fresh?: unknown };
	if (!examplesView(lessonId)) return Response.json({ error: "unknown lesson" }, { status: 404 });
	void ensureWorkedExamples(lessonId, { fresh: body.fresh === true });
	return Response.json(examplesView(lessonId));
}
