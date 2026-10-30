import { programIndex, resolveLecture } from "@/src/server";

/** A lesson's lectures with embeddable YouTube ids (resolved + cached). */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const lessonId = new URL(req.url).searchParams.get("lessonId") ?? "";
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) return Response.json({ error: "unknown lesson" }, { status: 404 });
	const lectures = await Promise.all(ref.lesson.lectures.map(resolveLecture));
	return Response.json({ lectures });
}
