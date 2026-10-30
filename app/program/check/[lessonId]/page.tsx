import { notFound } from "next/navigation";
import { QuickCheckPage } from "@/components/program/quick-check";
import { programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function CheckPage({ params }: { params: Promise<{ lessonId: string }> }) {
	const { lessonId } = await params;
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) notFound();
	return <QuickCheckPage lessonId={lessonId} lessonTitle={ref.lesson.title} courseCode={ref.course.code} />;
}
