import { notFound } from "next/navigation";
import { UnitDiagnosticPage } from "@/components/program/unit-diagnostic";
import { programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function DiagnosticPage({ params }: { params: Promise<{ unitId: string }> }) {
	const { unitId } = await params;
	const ref = programIndex().units.get(unitId);
	if (!ref) notFound();
	return (
		<UnitDiagnosticPage
			unitId={unitId}
			unitTitle={ref.unit.title}
			courseId={ref.course.id}
			courseCode={ref.course.code}
			lessons={ref.unit.lessons.map((l) => ({ id: l.id, title: l.title }))}
		/>
	);
}
