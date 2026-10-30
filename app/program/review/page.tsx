import { ReviewSession } from "@/components/program/review-session";
import { programIndex, progressSnapshot } from "@/src/server";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
	const index = programIndex();
	const snapshot = progressSnapshot();
	const item = (id: string) => {
		const ref = index.lessons.get(id)!;
		return { lessonId: id, title: ref.lesson.title, courseCode: ref.course.code };
	};
	// Missed quiz questions first (just those questions), then spaced reviews.
	const missed = snapshot.missedDue.map((id) => ({ ...item(id), only: snapshot.lessons[id]!.missed }));
	const due = snapshot.reviewsDue.filter((id) => !snapshot.missedDue.includes(id)).map(item);
	return <ReviewSession missed={missed} due={due} />;
}
