import { NotebookPage } from "@/components/program/notebook-page";

export const dynamic = "force-dynamic";

/** The teach-back notebook; `?print=1` shows it as printable paper. */
export default async function NotebookRoute({ searchParams }: { searchParams: Promise<{ print?: string }> }) {
	const { print } = await searchParams;
	return <NotebookPage print={print === "1"} />;
}
