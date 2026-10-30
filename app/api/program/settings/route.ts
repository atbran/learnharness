import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(stores.curriculumStore.readSettings());
}

export async function PUT(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { hoursPerWeek?: unknown; startDate?: unknown };
	const hours = typeof body.hoursPerWeek === "number" && body.hoursPerWeek > 0 && body.hoursPerWeek <= 80 ? body.hoursPerWeek : null;
	const start = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : null;
	stores.curriculumStore.writeSettings({ hoursPerWeek: hours, startDate: start });
	return Response.json({ ok: true });
}
