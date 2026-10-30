import { redirect } from "next/navigation";
import { openAssessment } from "@/src/server";

export const dynamic = "force-dynamic";

/** /program/assessment/new?unit=<unitId> | ?exam=<examId> [&fresh=1] →
 *  opens (or reuses an unfinished) assessment and redirects to it. */
export default async function NewAssessment({ searchParams }: { searchParams: Promise<{ unit?: string; exam?: string; fresh?: string }> }) {
	const sp = await searchParams;
	const a = openAssessment({ unitId: sp.unit, examId: sp.exam }, sp.fresh === "1");
	redirect(`/program/assessment/${a.id}`);
}
