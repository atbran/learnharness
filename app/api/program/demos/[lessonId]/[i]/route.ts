import { demoView, ensureLessonDemo, ensureLessonExplainer } from "@/src/server";

/** GET: one lesson demo (cached html), its Manim explainer, and their build
 *  states. POST {fresh?, kind?}: build the demo (or, with kind "explainer",
 *  render the animation) if not cached; `fresh` rebuilds a cached one. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string; i: string }> };

export async function GET(_req: Request, { params }: Params) {
	const { lessonId, i } = await params;
	const view = demoView(lessonId, Number(i));
	return view ? Response.json(view) : Response.json({ error: "unknown demo" }, { status: 404 });
}

export async function POST(req: Request, { params }: Params) {
	const { lessonId, i } = await params;
	const body = (await req.json().catch(() => ({}))) as { fresh?: boolean; kind?: string };
	try {
		(body.kind === "explainer" ? ensureLessonExplainer : ensureLessonDemo)(lessonId, Number(i), { fresh: !!body.fresh });
		return Response.json(demoView(lessonId, Number(i)));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
