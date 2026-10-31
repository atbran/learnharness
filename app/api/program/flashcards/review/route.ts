import { CARD_RATINGS, type CardRating } from "@/src/core";
import { reviewCard } from "@/src/server";

export const dynamic = "force-dynamic";

/** POST { cardId, rating } — grade one flip: again | hard | good | easy. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { cardId?: unknown; rating?: unknown };
	if (typeof body.cardId !== "string" || !CARD_RATINGS.includes(body.rating as CardRating))
		return Response.json({ error: "Body must be { cardId, rating: again|hard|good|easy }." }, { status: 400 });
	try {
		reviewCard(body.cardId, body.rating as CardRating);
		return Response.json({ ok: true });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
	}
}
