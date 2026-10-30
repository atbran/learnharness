import { AudioPage } from "@/components/program/audio-page";

export const dynamic = "force-dynamic";

export default async function AudioRoute({ searchParams }: { searchParams: Promise<{ lesson?: string; session?: string }> }) {
	const { lesson, session } = await searchParams;
	return <AudioPage focus={lesson ?? session ?? null} />;
}
