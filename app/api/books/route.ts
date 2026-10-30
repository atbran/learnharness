import { bookshelfView } from "@/src/server";

/** The shelf: catalog books with ingest state and reading-ref coverage. */
export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(bookshelfView());
}
