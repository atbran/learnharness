import { motivationView, programView, progressSnapshot, stores } from "@/src/server";

/** The Program UI's data: lean program structure + the derived snapshot. */
export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const snapshot = progressSnapshot();
		return Response.json({ program: programView(), snapshot, settings: stores.curriculumStore.readSettings(), motivation: motivationView(snapshot) });
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
	}
}
