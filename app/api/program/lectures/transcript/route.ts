import { lectureTranscript, programIndex } from "@/src/server";

/** GET ?lessonId&i: lecture i's transcript lines ({t, text}), trimmed to its
 *  clip; `lines: null` when none was fetched. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const url = new URL(req.url);
	const ref = programIndex().lessons.get(url.searchParams.get("lessonId") ?? "");
	const lecture = ref?.lesson.lectures[Number(url.searchParams.get("i"))];
	if (!lecture) return Response.json({ error: "unknown lecture" }, { status: 404 });
	return Response.json({ lines: await lectureTranscript(lecture) });
}
