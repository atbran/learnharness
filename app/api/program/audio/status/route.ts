import { audioGuide } from "@/src/server";

/** GET ?id=<lessonId|chatId>: one guide's state + script text. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const id = new URL(req.url).searchParams.get("id") ?? "";
	const guide = audioGuide(id);
	if (!guide) return Response.json({ error: "unknown guide" }, { status: 404 });
	return Response.json(guide);
}
