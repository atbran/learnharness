import { notFound } from "next/navigation";
import { DemoPage } from "@/components/program/demo-page";
import { demoView } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function DemoRoute({ params }: { params: Promise<{ lessonId: string; i: string }> }) {
	const { lessonId, i } = await params;
	const view = demoView(lessonId, Number(i));
	if (!view) notFound();
	return <DemoPage key={`${lessonId}/${i}`} initial={view} />;
}
