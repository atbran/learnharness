import { ensureQuickCheck, quickCheckView, submitQuickCheck } from "@/src/server";

/** GET: the lesson's quick check (answers stripped) or its generation state.
 *  POST {generate:true}: start writing it. POST {responses, review?, only?}: grade. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	return Response.json(quickCheckView(lessonId));
}

export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const body = (await req.json().catch(() => ({}))) as { generate?: boolean; responses?: unknown; review?: boolean; only?: unknown };
	try {
		if (body.generate) {
			ensureQuickCheck(lessonId);
			return Response.json(quickCheckView(lessonId));
		}
		const responses = Array.isArray(body.responses) ? body.responses.map((r) => String(r ?? "")) : [];
		const only = Array.isArray(body.only) ? body.only.map(Number).filter(Number.isInteger) : undefined;
		return Response.json(await submitQuickCheck(lessonId, responses, { review: !!body.review, only }));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
