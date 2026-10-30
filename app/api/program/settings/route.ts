import { sanitizePauses } from "@/src/core";
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
		pauses?: unknown;
		weekGoals?: unknown;
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
	if ("pauses" in body) next.pauses = sanitizePauses(body.pauses);
	// Week goals merge per week; an empty goal removes that week's.
	if (body.weekGoals && typeof body.weekGoals === "object") {
		const goals = { ...prev.weekGoals };
		for (const [week, goal] of Object.entries(body.weekGoals as Record<string, unknown>)) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || typeof goal !== "string") continue;
			if (goal.trim()) goals[week] = goal.trim().slice(0, 200);
			else delete goals[week];
		}
		next.weekGoals = goals;
	}
	stores.curriculumStore.writeSettings(next);
	return Response.json({ ok: true });
}
