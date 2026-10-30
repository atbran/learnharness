import { notFound } from "next/navigation";
import { LessonPage } from "@/components/program/lesson-page";
import { lessonDetail } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function LessonRoute({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const detail = lessonDetail(id);
	if (!detail) notFound();
	return <LessonPage detail={detail} />;
}
