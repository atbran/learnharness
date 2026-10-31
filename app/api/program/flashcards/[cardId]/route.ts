import { removeCard, restoreCard } from "@/src/server";

export const dynamic = "force-dynamic";

/** PATCH { removed } — take a card out of the deck (your own are deleted) or put a generated one back. */
export async function PATCH(req: Request, { params }: { params: Promise<{ cardId: string }> }) {
	const { cardId } = await params;
	const body = (await req.json().catch(() => ({}))) as { removed?: unknown };
	if (typeof body.removed !== "boolean") return Response.json({ error: "Body must be { removed: boolean }." }, { status: 400 });
	try {
		if (body.removed) removeCard(cardId);
		else restoreCard(cardId);
		return Response.json({ ok: true });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
	}
}
