import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { WorksheetPrint } from "@/components/program/worksheet-print";
import { getAssessment, ipadStatus, programIndex } from "@/src/server";

export const dynamic = "force-dynamic";

/** A practice sheet's print view: the problems on page 1 (with a QR code to
 *  the sheet in the app, for photo grading), worked answers on page 2. */
export default async function WorksheetPrintRoute({ params }: { params: Promise<{ id: string }> }) {
	const a = getAssessment((await params).id);
	if (!a) notFound();
	// The QR code opens the sheet from a phone: the Tailscale address when
	// iPad/iPhone access is on, else the address this page was opened at.
	const ipad = await ipadStatus().catch(() => null);
	const h = await headers();
	const origin = ipad?.serving && ipad.url ? new URL(ipad.url).origin : `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3217"}`;
	const index = programIndex();
	const lessons = (a.lessonIds ?? a.unitIds.flatMap((u) => index.units.get(u)?.unit.lessons.map((l) => l.id) ?? []))
		.map((id) => index.lessons.get(id))
		.filter((r) => r !== undefined)
		.map((r) => `${r.course.code} · ${r.lesson.title}`);
	return <WorksheetPrint sheet={a} lessons={lessons} sheetUrl={`${origin}/program/assessment/${a.id}`} />;
}
