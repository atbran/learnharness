import { notFound } from "next/navigation";
import { QuickCheckPage } from "@/components/program/quick-check";
import { programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

/** /program/check/<lessonId> — the lesson's quick check.
 *  ?q=<index>&thenNow=1 — "then and now": that one long-ago missed question, tried again. */
export default async function CheckPage({
	params,
	searchParams,
}: {
	params: Promise<{ lessonId: string }>;
	searchParams: Promise<{ q?: string; thenNow?: string }>;
}) {
	const { lessonId } = await params;
	const sp = await searchParams;
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) notFound();
	const q = Number(sp.q);
	const thenNow = sp.thenNow === "1" && sp.q !== undefined && Number.isInteger(q) && q >= 0;
	return (
		<QuickCheckPage
			lessonId={lessonId}
			lessonTitle={ref.lesson.title}
			courseCode={ref.course.code}
			only={thenNow ? [q] : undefined}
			thenNow={thenNow}
		/>
	);
}
