import { ProgramHome } from "@/components/program/program-home";
import { motivationView, programView, progressSnapshot, stores } from "@/src/server";

export const dynamic = "force-dynamic";

export default function ProgramPage() {
	let initial = null;
	try {
		const snapshot = progressSnapshot();
		initial = { program: programView(), snapshot, settings: stores.curriculumStore.readSettings(), motivation: motivationView(snapshot) };
	} catch {
		// The client retries via /api/program and shows the error there.
	}
	return <ProgramHome initial={initial} />;
}
