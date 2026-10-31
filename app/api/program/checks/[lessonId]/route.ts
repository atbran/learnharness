import { ensureQuickCheck, overrideShortAnswer, quickCheckView, submitQuickCheck } from "@/src/server";

/** GET: the lesson's quick check (answers stripped) or its generation state.
 *  POST {generate:true}: start writing it. POST {responses, review?, only?, missedRetake?}: grade (missedRetake: a retake of
 *  the missed questions, which only updates the missed set; thenNow: one
 *  long-ago missed question tried again). POST {override, credits, overridden}:
 *  count short answer `override` as correct and re-score the attempt. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	return Response.json(quickCheckView(lessonId));
}

export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const body = (await req.json().catch(() => ({}))) as {
		generate?: boolean;
		responses?: unknown;
		review?: boolean;
		only?: unknown;
		missedRetake?: boolean;
		thenNow?: boolean;
		override?: unknown;
		credits?: unknown;
		overridden?: unknown;
	};
	try {
		if (typeof body.override === "number") {
			const credits = Array.isArray(body.credits) ? body.credits.map(Number) : [];
			const overridden = Array.isArray(body.overridden) ? body.overridden.map(Number).filter(Number.isInteger) : [];
			return Response.json(overrideShortAnswer(lessonId, credits, body.override, overridden));
		}
		if (body.generate) {
			ensureQuickCheck(lessonId);
			return Response.json(quickCheckView(lessonId));
		}
		const responses = Array.isArray(body.responses) ? body.responses.map((r) => String(r ?? "")) : [];
		const only = Array.isArray(body.only) ? body.only.map(Number).filter(Number.isInteger) : undefined;
		return Response.json(await submitQuickCheck(lessonId, responses, { review: !!body.review, only, missedRetake: !!body.missedRetake, thenNow: !!body.thenNow }));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
