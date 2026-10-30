import { ProgramHome } from "@/components/program/program-home";
import { programView, progressSnapshot } from "@/src/server";

export const dynamic = "force-dynamic";

export default function ProgramPage() {
	let initial = null;
	try {
		initial = { program: programView(), snapshot: progressSnapshot() };
	} catch {
		// The client retries via /api/program and shows the error there.
	}
	return <ProgramHome initial={initial} />;
}
