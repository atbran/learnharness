import { audioGuideState, ensureLessonAudio, ensureSessionAudio } from "@/src/server";

/** POST {lessonId, rewrite?, resynth?} | {chatId, resynth?}: start generating
 *  an audio guide in the background; returns its state. */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { lessonId?: unknown; chatId?: unknown; rewrite?: unknown; resynth?: unknown };
	try {
		if (typeof body.lessonId === "string") {
			ensureLessonAudio(body.lessonId, { rewrite: body.rewrite === true, resynth: body.resynth === true });
			return Response.json(audioGuideState(body.lessonId));
		}
		if (typeof body.chatId === "string") {
			ensureSessionAudio(body.chatId, { resynth: body.resynth === true });
			return Response.json(audioGuideState(body.chatId));
		}
		return Response.json({ error: "lessonId or chatId required" }, { status: 400 });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
