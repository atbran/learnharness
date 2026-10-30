import { notFound } from "next/navigation";
import { CoursePage } from "@/components/program/course-page";
import { programIndex, programView, progressSnapshot, stores } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function CourseRoute({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!programIndex().courses.has(id)) notFound();
	return <CoursePage courseId={id} initial={{ program: programView(), snapshot: progressSnapshot(), settings: stores.curriculumStore.readSettings() }} />;
}
