"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookCheckIcon, BookOpenIcon, ChevronRightIcon, DownloadIcon, InboxIcon, Loader2Icon, SearchIcon, UploadIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { pct } from "./status";

interface ShelfBook {
	id: string;
	title: string;
	authors: string[];
	edition?: string;
	freeUrl?: string;
	ingested: { pageCount: number; ingestedAt: string; sourceName: string; outlineEntries: number } | null;
	ingest: { status: "running" | "done" | "error"; done: number; total: number; error?: string } | null;
	refCount: number;
	lessonCount: number;
	unresolved: { lessonId: string; ref: string; title: string }[];
	unresolvedCount: number;
}

interface Hit {
	bookId: string;
	page: number;
	label: string | null;
	section: string | null;
	snippet: string;
}

/** The shelf: every catalog book, its ingest state, and how many lesson
 *  readings resolve to pages. Upload a PDF per book, or drop files into
 *  data/books/inbox and scan. Search across everything ingested. */
export function Bookshelf() {
	const [books, setBooks] = useState<ShelfBook[] | null>(null);
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<Hit[] | null>(null);
	const [scanning, setScanning] = useState(false);
	const refresh = useCallback(() => {
		void fetch("/api/books")
			.then((r) => r.json())
			.then((b: { books: ShelfBook[] }) => setBooks(b.books));
	}, []);
	useEffect(refresh, [refresh]);
	useServerEvent("curriculum-changed", refresh);

	const ingestedCount = books?.filter((b) => b.ingested).length ?? 0;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span>Bookshelf</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[1200px] space-y-5 px-6 py-5">
					<header className="flex flex-wrap items-end gap-4">
						<div className="flex-1">
							<h1 className="font-title text-4xl tracking-tight">Bookshelf</h1>
							<p className="mt-1 max-w-3xl text-sm text-muted-foreground">
								Add the PDFs of the program's textbooks. Each is indexed once on this machine (no AI tokens), so lessons open at the right pages and
								your tutor can look things up in a few hundred tokens instead of reading whole chapters.
							</p>
						</div>
						<button
							type="button"
							disabled={scanning}
							onClick={async () => {
								setScanning(true);
								await fetch("/api/books/scan", { method: "POST" }).catch(() => null);
								setScanning(false);
								refresh();
							}}
							className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
							title="Ingest PDFs placed in data/books/inbox/"
						>
							{scanning ? <Loader2Icon className="size-4 animate-spin" /> : <InboxIcon className="size-4" />} Scan inbox folder
						</button>
					</header>

					<form
						className="flex gap-2"
						onSubmit={async (e) => {
							e.preventDefault();
							if (!query.trim()) return;
							const r = await fetch(`/api/books/search?q=${encodeURIComponent(query)}`);
							setHits(((await r.json()) as { hits: Hit[] }).hits);
						}}
					>
						<div className="relative flex-1">
							<SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder={ingestedCount ? `Search ${ingestedCount} book${ingestedCount > 1 ? "s" : ""}…  e.g. "method of images"` : "Add a book to search"}
								className="lh-input w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm"
							/>
						</div>
					</form>
					{hits && (
						<div className="space-y-2 rounded-xl border border-border bg-card p-3">
							{hits.length === 0 && <div className="text-sm text-muted-foreground">No matches.</div>}
							{hits.map((h, i) => (
								<Link key={i} href={`/program/books/${h.bookId}?page=${h.page}`} className="block rounded-lg p-2 hover:bg-accent">
									<div className="text-xs text-muted-foreground">
										{h.bookId} · p.{h.label ?? h.page}
										{h.section ? ` · ${h.section}` : ""}
									</div>
									<div className="text-sm" dangerouslySetInnerHTML={{ __html: escapeSnippet(h.snippet) }} />
								</Link>
							))}
						</div>
					)}

					<div className="grid gap-3 md:grid-cols-2">
						{books?.map((b) => <BookCard key={b.id} book={b} onChanged={refresh} />)}
					</div>
				</div>
			</div>
		</div>
	);
}

function escapeSnippet(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/«/g, '<mark class="bg-[var(--xp)]/30 text-foreground rounded px-0.5">')
		.replace(/»/g, "</mark>");
}

function BookCard({ book, onChanged }: { book: ShelfBook; onChanged: () => void }) {
	const input = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showRefs, setShowRefs] = useState(false);
	const running = book.ingest?.status === "running";
	const resolved = book.refCount - book.unresolvedCount;
	return (
		<div className={cn("rounded-xl border bg-card p-4", book.ingested ? "border-[var(--st-mastered)]/60" : "border-border")}>
			<div className="flex items-start gap-3">
				{book.ingested ? <BookCheckIcon className="mt-0.5 size-5 text-[var(--st-mastered)]" /> : <BookOpenIcon className="mt-0.5 size-5 text-muted-foreground" />}
				<div className="min-w-0 flex-1">
					<div className="font-semibold leading-snug">
						{book.title}
						{book.edition ? <span className="font-normal text-muted-foreground"> ({book.edition})</span> : null}
					</div>
					<div className="text-xs text-muted-foreground">{book.authors.join(", ")}</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Used by {book.lessonCount} lesson{book.lessonCount === 1 ? "" : "s"} · {book.refCount} reading{book.refCount === 1 ? "" : "s"}
					</div>
				</div>
			</div>

			{running && book.ingest && (
				<div className="mt-3">
					<div className="h-1.5 overflow-hidden rounded bg-accent">
						<div className="h-full bg-[var(--st-available)] transition-all" style={{ width: pct(book.ingest.done / Math.max(1, book.ingest.total)) }} />
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Indexing… page {book.ingest.done}/{book.ingest.total || "?"}
					</div>
				</div>
			)}
			{book.ingest?.status === "error" && <div className="mt-2 text-xs text-destructive">Ingest failed: {book.ingest.error}</div>}
			{error && <div className="mt-2 text-xs text-destructive">{error}</div>}

			{book.ingested && (
				<div className="mt-3 text-xs">
					<span className="text-muted-foreground">
						{book.ingested.pageCount} pages · {book.ingested.outlineEntries} outline entries ·{" "}
					</span>
					<button type="button" className={cn("hover:underline", book.unresolvedCount ? "text-[var(--st-progress)]" : "text-[var(--st-mastered)]")} onClick={() => setShowRefs((v) => !v)}>
						{resolved}/{book.refCount} readings located
					</button>
					{showRefs && book.unresolved.length > 0 && (
						<ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-muted-foreground">
							{book.unresolved.map((u, i) => (
								<li key={i}>
									<Link href={`/program/lesson/${u.lessonId}`} className="hover:text-foreground">
										{u.ref} {u.title}
									</Link>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			<div className="mt-3 flex flex-wrap gap-2">
				{book.ingested && (
					<Link href={`/program/books/${book.id}`} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
						Open reader
					</Link>
				)}
				<button
					type="button"
					disabled={uploading || running}
					onClick={() => input.current?.click()}
					className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
				>
					{uploading ? <Loader2Icon className="size-3.5 animate-spin" /> : <UploadIcon className="size-3.5" />}
					{book.ingested ? "Replace PDF" : "Add PDF"}
				</button>
				{book.freeUrl && (
					<a href={book.freeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">
						<DownloadIcon className="size-3.5" /> Free legal copy
					</a>
				)}
				<input
					ref={input}
					type="file"
					accept="application/pdf,.pdf"
					className="hidden"
					onChange={async (e) => {
						const file = e.target.files?.[0];
						e.target.value = "";
						if (!file) return;
						setUploading(true);
						setError(null);
						const r = await fetch(`/api/books/upload?bookId=${book.id}&name=${encodeURIComponent(file.name)}`, {
							method: "POST",
							headers: { "Content-Type": "application/pdf" },
							body: file,
						}).catch(() => null);
						setUploading(false);
						if (!r?.ok) setError(((await r?.json().catch(() => null)) as { error?: string } | null)?.error ?? "upload failed");
						onChanged();
					}}
				/>
			</div>
		</div>
	);
}
