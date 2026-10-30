import { progressEventSchema } from "@/src/core";
import { recordProgress } from "@/src/server";

/** Learner-originated ledger events (start, complete, study time, reviews).
 *  Scores from checks/assessments are written server-side by their own
 *  routes — this endpoint refuses them so a client can't forge a grade. */
const CLIENT_TYPES = new Set(["lesson_started", "lesson_completed", "study_time", "review_done"]);

export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
	const parsed = progressEventSchema.safeParse({ at: new Date().toISOString(), ...body });
	if (!parsed.success || !CLIENT_TYPES.has(parsed.data.type)) return Response.json({ error: "invalid event" }, { status: 400 });
	try {
		recordProgress(parsed.data);
		return Response.json({ ok: true });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
