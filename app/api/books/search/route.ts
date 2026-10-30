import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const url = new URL(req.url);
	const q = url.searchParams.get("q") ?? "";
	const book = url.searchParams.get("book");
	return Response.json({ hits: stores.bookshelfStore.search(q, { bookIds: book ? [book] : undefined, k: 12 }) });
}
