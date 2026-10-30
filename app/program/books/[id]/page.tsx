import { notFound } from "next/navigation";
import { BookReader } from "@/components/program/book-reader";
import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function BookReaderPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ page?: string; end?: string }>;
}) {
	const [{ id }, sp] = await Promise.all([params, searchParams]);
	const book = /^[a-z0-9-]+$/.test(id) ? stores.bookshelfStore.getBook(id) : null;
	if (!book) notFound();
	const start = Math.max(1, Math.min(book.pageCount, Number(sp.page) || 1));
	const end = sp.end ? Math.max(start, Math.min(book.pageCount, Number(sp.end))) : null;
	const labels = stores.bookshelfStore.allPages(id).map((p) => p.label);
	return <BookReader bookId={id} title={book.title} pageCount={book.pageCount} labels={labels} start={start} end={end} />;
}
