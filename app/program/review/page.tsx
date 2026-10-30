import { ReviewSession } from "@/components/program/review-session";
import { programIndex, progressSnapshot } from "@/src/server";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
	const index = programIndex();
	const due = progressSnapshot().reviewsDue.map((id) => {
		const ref = index.lessons.get(id)!;
		return { lessonId: id, title: ref.lesson.title, courseCode: ref.course.code };
	});
	return <ReviewSession due={due} />;
}
