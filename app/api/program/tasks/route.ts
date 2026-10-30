import { programTasks } from "@/src/server";

/** Background program work (check/exam writing, grading, audio). */
export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ tasks: programTasks() });
}
