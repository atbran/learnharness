import { notFound } from "next/navigation";
import { WorkedExamplesPage } from "@/components/program/worked-examples";
import { programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

/** /program/examples/<lessonId> — the lesson's worked examples. */
export default async function ExamplesPage({ params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) notFound();
	return <WorkedExamplesPage lessonId={lessonId} lessonTitle={ref.lesson.title} courseCode={ref.course.code} objectives={ref.lesson.objectives} />;
}
