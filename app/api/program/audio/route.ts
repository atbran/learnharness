import { audioGuides } from "@/src/server";

/** GET: every audio guide (script/audio/running job), the teaching sessions
 *  that could be read aloud, and whether local TTS is set up. */
export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(audioGuides());
}
