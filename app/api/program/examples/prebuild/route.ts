import { examplesPrebuildStatus, setExamplesPrebuild } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET — progress of the background worked-examples build. */
export async function GET() {
	return Response.json(examplesPrebuildStatus());
}

/** PUT { enabled, retryFailed?, courses? } — start/pause it; courses (ids) limits it ([] = every course). */
export async function PUT(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { enabled?: unknown; retryFailed?: unknown; courses?: unknown };
	if (typeof body.enabled !== "boolean") return Response.json({ error: "Body must be { enabled: boolean }." }, { status: 400 });
	const courses = Array.isArray(body.courses) && body.courses.every((c) => typeof c === "string") ? (body.courses as string[]) : undefined;
	return Response.json(setExamplesPrebuild(body.enabled, { retryFailed: body.retryFailed === true, courses }));
}
