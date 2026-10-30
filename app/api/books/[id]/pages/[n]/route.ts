import { renderBookPage } from "@/src/server";

/** One rendered textbook page (PNG, disk-cached). ?dpi=72..200 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
	const { id, n } = await params;
	const dpi = Math.max(72, Math.min(200, Number(new URL(req.url).searchParams.get("dpi")) || 110));
	try {
		const png = await renderBookPage(id, Number(n), dpi);
		if (!png) return new Response("not found", { status: 404 });
		return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
	} catch (err) {
		return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
	}
}
