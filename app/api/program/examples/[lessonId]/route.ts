import { ensureWorkedExamples, examplesView, recordExampleAttempt } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET — the lesson's worked examples (or writing/missing/error). */
export async function GET(_req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const view = examplesView(lessonId);
	return view ? Response.json(view) : Response.json({ error: "unknown lesson" }, { status: 404 });
}

/** POST { fresh? } — write the examples now (background).
 *  POST { attempt: { example, confidence?, result?, stuck? } } — save your report on trying one. */
export async function POST(req: Request, { params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const body = (await req.json().catch(() => ({}))) as { fresh?: unknown; attempt?: { example?: unknown; confidence?: unknown; result?: unknown; stuck?: unknown } };
	if (!examplesView(lessonId)) return Response.json({ error: "unknown lesson" }, { status: 404 });
	if (body.attempt) {
		const { example, confidence, result, stuck } = body.attempt;
		if (!Number.isInteger(example) || (example as number) < 0) return Response.json({ error: "attempt.example must be an example index" }, { status: 400 });
		try {
			recordExampleAttempt(lessonId, {
				example: example as number,
				confidence: Number.isInteger(confidence) && (confidence as number) >= 1 && (confidence as number) <= 5 ? (confidence as number) : undefined,
				result: result === "got" || result === "partly" || result === "missed" ? result : undefined,
				stuck: typeof stuck === "string" ? stuck.slice(0, 4000) : undefined,
			});
			return Response.json({ ok: true });
		} catch (err) {
			return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
		}
	}
	void ensureWorkedExamples(lessonId, { fresh: body.fresh === true });
	return Response.json(examplesView(lessonId));
}
