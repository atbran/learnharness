import { ProgramHome } from "@/components/program/program-home";
import { programView, progressSnapshot, stores } from "@/src/server";

export const dynamic = "force-dynamic";

export default function ProgramPage() {
	let initial = null;
	try {
		initial = { program: programView(), snapshot: progressSnapshot(), settings: stores.curriculumStore.readSettings() };
	} catch {
		// The client retries via /api/program and shows the error there.
	}
	return <ProgramHome initial={initial} />;
}
