import { notFound } from "next/navigation";
import { AssessmentPage } from "@/components/program/assessment-page";
import { assessmentView, getAssessment, programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function AssessmentRoute({ params }: { params: Promise<{ id: string }> }) {
	const a = getAssessment((await params).id);
	if (!a) notFound();
	const course = programIndex().courses.get(a.courseId);
	return <AssessmentPage initial={assessmentView(a)} course={{ id: a.courseId, code: course?.code ?? "", title: course?.title ?? "" }} />;
}
