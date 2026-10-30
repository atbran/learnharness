import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(stores.curriculumStore.readSettings());
}

/** Merge: only the fields present in the body change. */
export async function PUT(req: Request) {
	const body = (await req.json().catch(() => ({}))) as {
		hoursPerWeek?: unknown;
		startDate?: unknown;
		parallelCourses?: unknown;
		reviewMode?: unknown;
		unitWeeks?: unknown;
	};
	const prev = stores.curriculumStore.readSettings();
	const next = { ...prev };
	if ("hoursPerWeek" in body)
		next.hoursPerWeek = typeof body.hoursPerWeek === "number" && body.hoursPerWeek > 0 && body.hoursPerWeek <= 80 ? body.hoursPerWeek : null;
	if ("startDate" in body) next.startDate = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ? body.startDate : null;
	if ("parallelCourses" in body)
		next.parallelCourses =
			typeof body.parallelCourses === "number" && body.parallelCourses >= 1 && body.parallelCourses <= 6 ? Math.round(body.parallelCourses) : null;
	if (Array.isArray(body.reviewMode)) next.reviewMode = [...new Set(body.reviewMode.filter((x): x is string => typeof x === "string"))];
	if (body.unitWeeks && typeof body.unitWeeks === "object")
		next.unitWeeks = Object.fromEntries(
			Object.entries(body.unitWeeks as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] >= 0.25 && e[1] <= 12),
		);
	stores.curriculumStore.writeSettings(next);
	return Response.json({ ok: true });
}
