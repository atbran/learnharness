"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";

type NotesView =
	| { status: "ready"; notes: { markdown: string; createdAt: string } }
	| { status: "writing" | "missing" }
	| { status: "error"; error: string };

/** The lesson's written notes (teach it on their own, beside the lecture):
 *  a preview that expands to the full text. */
export function LessonNotes({ lessonId }: { lessonId: string }) {
	const [view, setView] = useState<NotesView | null>(null);
	const [open, setOpen] = useState(false);
	const load = useCallback(() => {
		void fetch(`/api/program/notes/${lessonId}`, { cache: "no-store" })
			.then((r) => r.json())
			.then(setView);
	}, [lessonId]);
	useEffect(load, [load]);
	useServerEvent("curriculum-changed", () => {
		if (view?.status !== "ready") load();
	});

	const write = async () => {
		const r = await fetch(`/api/program/notes/${lessonId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
		setView((await r.json()) as NotesView);
	};

	if (!view) return null;
	return (
		<section className="rounded-xl border border-border bg-card" data-testid="lesson-notes">
			<h2 className="flex items-center gap-2 px-4 pt-4 text-xs uppercase tracking-wider text-muted-foreground">
				<FileTextIcon className="size-3.5" /> Notes
			</h2>
			{view.status === "ready" ? (
				<>
					<div className={cn("lh-prose relative px-4 pb-2 pt-2", !open && "max-h-72 overflow-hidden")}>
						<MessageResponse>{view.notes.markdown}</MessageResponse>
						{!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card to-transparent" />}
					</div>
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						aria-expanded={open}
						className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11"
					>
						{open ? "Show less" : "Read the full notes"}
						<ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
					</button>
				</>
			) : view.status === "writing" ? (
				<p className="flex items-center gap-2 px-4 pb-4 pt-2 text-sm text-muted-foreground">
					<Loader2Icon className="size-4 animate-spin" /> Writing the notes from this lesson and its book pages… (a few minutes, once)
				</p>
			) : (
				<div className="px-4 pb-4 pt-2 text-sm text-muted-foreground">
					{view.status === "error" && <p className="mb-2 text-destructive">{view.error}</p>}
					<p>Written notes that teach this lesson on their own — the idea, the intuition, the equations explained, a worked example and the book pages.</p>
					<button
						type="button"
						onClick={() => void write()}
						className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent pointer-coarse:min-h-11"
					>
						{view.status === "error" ? "Try again" : "Write the notes"}
					</button>
				</div>
			)}
		</section>
	);
}
