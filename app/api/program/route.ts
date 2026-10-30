import { programView, progressSnapshot } from "@/src/server";

/** The Program UI's data: lean program structure + the derived snapshot. */
export const dynamic = "force-dynamic";

export async function GET() {
	try {
		return Response.json({ program: programView(), snapshot: progressSnapshot() });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
	}
}
