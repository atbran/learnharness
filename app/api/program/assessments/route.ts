import { assessmentView, listAssessments, openAssessment } from "@/src/server";

export const dynamic = "force-dynamic";

/** GET: every assessment (newest first). POST {unitId | examId, fresh?}: open
 *  one; POST {worksheet: true, unitId?}: a new printable practice sheet. */
export async function GET() {
	return Response.json({ assessments: listAssessments().map((a) => ({ id: a.id, kind: a.kind, title: a.title, courseId: a.courseId, status: a.status, createdAt: a.createdAt, score: a.grade?.score ?? null })) });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { unitId?: string; examId?: string; fresh?: boolean; worksheet?: boolean };
	try {
		return Response.json(assessmentView(
				openAssessment(body.worksheet ? { worksheet: { unitId: body.unitId } } : { unitId: body.unitId, examId: body.examId }, !!body.fresh),
			));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}
