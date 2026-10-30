import { addQuestion, listQuestions, removeQuestion } from "@/src/server";

/** The question board. GET: the questions. POST {text}: add one (matched to
 *  a lesson in the background). DELETE ?id: remove one. */
export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ questions: listQuestions() });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { text?: unknown };
	try {
		return Response.json(addQuestion(typeof body.text === "string" ? body.text : ""));
	} catch (err) {
		return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
	}
}

export async function DELETE(req: Request) {
	removeQuestion(new URL(req.url).searchParams.get("id") ?? "");
	return Response.json({ ok: true });
}
