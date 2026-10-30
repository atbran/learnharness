import { notFound } from "next/navigation";
import { EquationSheet } from "@/components/program/equation-sheet";
import { programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

/** A unit's printable equation sheet: every lesson's key equations on one page. */
export default async function UnitEquationsPage({ params }: { params: Promise<{ unitId: string }> }) {
	const ref = programIndex().units.get((await params).unitId);
	if (!ref) notFound();
	return (
		<EquationSheet
			course={{ id: ref.course.id, code: ref.course.code, title: ref.course.title }}
			unit={{ title: ref.unit.title }}
			lessons={ref.unit.lessons.map((l) => ({ id: l.id, title: l.title, equations: l.keyEquations }))}
		/>
	);
}
