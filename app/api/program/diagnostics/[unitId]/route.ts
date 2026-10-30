import { diagnosticView, ensureDiagnostic, submitDiagnostic } from "@/src/server";

/** GET: the unit's test-out diagnostic (answers stripped) or its generation
 *  state. POST {generate:true}: start writing it. POST {responses}: grade. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ unitId: string }> }) {
	const { unitId } = await params;
	const view = diagnosticView(unitId);
	return view ? Response.json(view) : Response.json({ error: "unknown unit" }, { status: 404 });
}

export async function POST(req: Request, { params }: { params: Promise<{ unitId: string }> }) {
	const { unitId } = await params;
	const body = (await req.json().catch(() => ({}))) as { generate?: boolean; responses?: unknown };
	try {
		if (body.generate) {
			ensureDiagnostic(unitId);
			return Response.json(diagnosticView(unitId));
		}
		const responses = Array.isArray(body.responses) ? body.responses.map((r) => String(r ?? "")) : [];
		return Response.json(submitDiagnostic(unitId, responses));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
