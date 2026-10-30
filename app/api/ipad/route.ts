import { ipadStatus, setIpadAccess } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET — Tailscale + serve state for the iPad access settings. */
export async function GET() {
	return Response.json(await ipadStatus());
}

/** PUT { enabled, port } — turn iPad access on (serve our port) or off. */
export async function PUT(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { enabled?: unknown; port?: unknown };
	if (typeof body.enabled !== "boolean" || typeof body.port !== "number") {
		return Response.json({ ok: false, error: "Body must be { enabled: boolean, port: number }." }, { status: 400 });
	}
	const result = await setIpadAccess(body.enabled, body.port);
	return Response.json(result, { status: result.ok ? 200 : 409 });
}
