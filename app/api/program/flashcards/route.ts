import { addCard, deckView, programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET — the whole deck (due today first), with each card's lesson and course. */
export async function GET() {
	const deck = deckView();
	const index = programIndex();
	const lessons = Object.fromEntries(
		[...new Set(deck.cards.map((c) => c.lessonId))].map((id) => {
			const ref = index.lessons.get(id)!;
			return [id, { title: ref.lesson.title, unitId: ref.unit.id, courseId: ref.course.id, courseCode: ref.course.code, courseTitle: ref.course.title, track: ref.course.track }];
		}),
	);
	return Response.json({ ...deck, lessons });
}

/** POST { lessonId, front, back } — add your own card to a lesson's deck. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { lessonId?: unknown; front?: unknown; back?: unknown };
	const { lessonId, front, back } = body;
	if (typeof lessonId !== "string" || typeof front !== "string" || typeof back !== "string" || !front.trim() || !back.trim())
		return Response.json({ error: "Body must be { lessonId, front, back } with non-empty text." }, { status: 400 });
	try {
		return Response.json({ cardId: addCard(lessonId, front, back) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
