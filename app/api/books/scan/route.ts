import { scanInbox } from "@/src/server";

/** Ingest every PDF in data/books/inbox/ that matches a catalog book. */
export async function POST() {
	return Response.json({ results: await scanInbox() });
}
