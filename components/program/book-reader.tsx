"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { useStudyHeartbeat } from "./use-program";

/**
 * The textbook reader: server-rendered page images (cached PNGs — no PDF
 * runs in the browser), opened at an assigned range. Arrow keys turn
 * pages; the assigned range is marked in the page strip.
 */
export function BookReader({
	bookId,
	title,
	pageCount,
	labels,
	start,
	end,
}: {
	bookId: string;
	title: string;
	pageCount: number;
	labels: (string | null)[];
	start: number;
	end: number | null;
}) {
	const [page, setPage] = useState(start);
	const [dpi, setDpi] = useState(110);
	useStudyHeartbeat();
	const go = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement) return;
			if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
			if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	const label = (p: number) => labels[p - 1] ?? String(p);
	const inRange = (p: number) => end !== null && p >= start && p <= end;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program/books" className="hover:text-foreground">
						Bookshelf
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span className="truncate">{title}</span>
				</div>
				<div className="ml-auto flex items-center gap-1 text-sm">
					<button type="button" onClick={() => setDpi((d) => Math.max(72, d - 20))} className="rounded p-1.5 hover:bg-accent" aria-label="Zoom out">
						<MinusIcon className="size-4" />
					</button>
					<button type="button" onClick={() => setDpi((d) => Math.min(200, d + 20))} className="rounded p-1.5 hover:bg-accent" aria-label="Zoom in">
						<PlusIcon className="size-4" />
					</button>
					<button type="button" onClick={() => go(page - 1)} className="rounded p-1.5 hover:bg-accent" aria-label="Previous page">
						<ChevronLeftIcon className="size-4" />
					</button>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							const v = Number(new FormData(e.currentTarget).get("p"));
							if (v) go(v);
						}}
					>
						<input
							name="p"
							key={page}
							defaultValue={page}
							className="lh-input w-14 rounded border border-border bg-background px-1.5 py-0.5 text-center text-xs"
						/>
					</form>
					<span className="text-xs text-muted-foreground">
						/ {pageCount} · printed {label(page)}
					</span>
					<button type="button" onClick={() => go(page + 1)} className="rounded p-1.5 hover:bg-accent" aria-label="Next page">
						<ChevronRightIcon className="size-4" />
					</button>
				</div>
			</TopBar>
			{end !== null && (
				<div className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2 text-xs">
					<span className="mr-2 shrink-0 text-muted-foreground">Assigned:</span>
					{Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
						<button
							key={p}
							type="button"
							onClick={() => go(p)}
							className={cn("shrink-0 rounded px-2 py-0.5", p === page ? "bg-foreground text-background" : "bg-accent hover:bg-accent/70")}
						>
							{label(p)}
						</button>
					))}
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-auto bg-[#0e0e0e] p-4">
				{/* eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG of a local PDF page */}
				<img
					key={`${page}@${dpi}`}
					src={`/api/books/${bookId}/pages/${page}?dpi=${dpi}`}
					alt={`${title}, page ${label(page)}`}
					className={cn("mx-auto rounded bg-white shadow-2xl", inRange(page) && "ring-2 ring-[var(--st-available)]")}
				/>
				{/* Prefetch the next page so turning feels instant. */}
				{page < pageCount && (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={`/api/books/${bookId}/pages/${page + 1}?dpi=${dpi}`} alt="" className="hidden" />
				)}
			</div>
		</div>
	);
}
