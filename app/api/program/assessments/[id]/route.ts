import { assessmentView, getAssessment, retryAssessment, saveAnswer, startAssessment, submitAssessment } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const a = getAssessment((await params).id);
	return a ? Response.json(assessmentView(a)) : Response.json({ error: "not found" }, { status: 404 });
}

/** POST {action: "start" | "answer" | "submit" | "retry", problemId?, text?} */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => ({}))) as { action?: string; problemId?: string; text?: string };
	try {
		if (body.action === "start") startAssessment(id);
		else if (body.action === "answer") saveAnswer(id, String(body.problemId), String(body.text ?? ""));
		else if (body.action === "submit") submitAssessment(id);
		else if (body.action === "retry") retryAssessment(id);
		else return Response.json({ error: "unknown action" }, { status: 400 });
		return Response.json(assessmentView(getAssessment(id)!));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
