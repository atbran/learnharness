"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, FileTextIcon, TargetIcon, ZapIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { fastTrackNotes } from "@/lib/notes-sections";

type NotesView =
	| { status: "ready"; notes: { markdown: string } }
	| { status: "writing" | "missing" }
	| { status: "error"; error?: string };

const overrideKey = (lessonId: string) => `lh-fast-track:${lessonId}`;

/** The learner's per-lesson "Fast track / Full lesson" choice, or null when
 *  they never picked one. `undefined` until read (post-mount, SSR-safe). */
export function useFastTrackOverride(lessonId: string): [boolean | null | undefined, (fast: boolean) => void] {
	const [stored, setStored] = useState<{ lessonId: string; fast: boolean | null } | null>(null);
	useEffect(() => {
		let fast: boolean | null = null;
		try {
			const v = window.localStorage.getItem(overrideKey(lessonId));
			fast = v === "fast" ? true : v === "full" ? false : null;
		} catch {
			/* no storage: no override */
		}
		setStored({ lessonId, fast });
	}, [lessonId]);
	const set = useCallback(
		(fast: boolean) => {
			try {
				window.localStorage.setItem(overrideKey(lessonId), fast ? "fast" : "full");
			} catch {
				/* private mode: the choice lasts this page only */
			}
			setStored({ lessonId, fast });
		},
		[lessonId],
	);
	return [stored?.lessonId === lessonId ? stored.fast : undefined, set];
}

/** The lesson's notes (same endpoint as <LessonNotes>), re-read on
 *  curriculum-changed until they are ready. */
export function useLessonNotesView(lessonId: string): NotesView | null {
	const [view, setView] = useState<{ lessonId: string; view: NotesView } | null>(null);
	const load = useCallback(() => {
		void fetch(`/api/program/notes/${lessonId}`, { cache: "no-store" })
			.then((r) => r.json())
			.then((v: NotesView) => setView({ lessonId, view: v }))
			.catch(() => setView({ lessonId, view: { status: "error" } }));
	}, [lessonId]);
	useEffect(load, [load]);
	const current = view?.lessonId === lessonId ? view.view : null;
	useServerEvent("curriculum-changed", () => {
		if (current?.status !== "ready") load();
	});
	return current;
}

/** The two-way header switch. */
export function FastTrackSwitch({ fast, onChange }: { fast: boolean; onChange: (fast: boolean) => void }) {
	const opt = (on: boolean, label: string) => (
		<button
			type="button"
			role="radio"
			aria-checked={fast === on}
			onClick={() => onChange(on)}
			className={cn(
				"flex items-center gap-1 rounded-md px-2.5 py-1 pointer-coarse:min-h-11",
				fast === on ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
			)}
		>
			{on && <ZapIcon className="size-3" />}
			{label}
		</button>
	);
	return (
		<div role="radiogroup" aria-label="Lesson view" className="flex items-center rounded-lg border border-border p-0.5 text-xs" data-testid="fast-track-switch">
			{opt(true, "Fast track")}
			{opt(false, "Full lesson")}
		</div>
	);
}

/** What the unit diagnostic caught: each missed prompt and why. */
export function MissedCard({ missed }: { missed: { prompt: string; explanation: string }[] }) {
	return (
		<section className="rounded-xl border border-[var(--st-review)]/50 bg-card p-4" data-testid="fast-track-missed">
			<h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--st-review)]">
				<TargetIcon className="size-3.5" /> You missed
			</h2>
			<ul className="space-y-4">
				{missed.map((m, i) => (
					<li key={i} className={cn(i > 0 && "border-t border-border pt-4")}>
						<div className="lh-prose text-[15px]">
							<MessageResponse>{m.prompt}</MessageResponse>
						</div>
						<div className="lh-prose mt-2 text-sm text-muted-foreground">
							<MessageResponse>{m.explanation}</MessageResponse>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

/** The notes' big idea, math and common mistakes. */
export function NotesSummary({ markdown }: { markdown: string }) {
	return (
		<section className="rounded-xl border border-border bg-card" data-testid="fast-track-notes">
			<h2 className="flex items-center gap-2 px-4 pt-4 text-xs uppercase tracking-wider text-muted-foreground">
				<FileTextIcon className="size-3.5" /> Notes summary
			</h2>
			<div className="lh-prose px-4 pb-4 pt-2">
				<MessageResponse>{markdown}</MessageResponse>
			</div>
		</section>
	);
}

export function useNotesSummary(view: NotesView | null): string | null {
	return useMemo(() => (view?.status === "ready" ? fastTrackNotes(view.notes.markdown) : null), [view]);
}

/** A collapsed row that reveals its children (Lecture, Full notes). */
export function Expander({ icon: Icon, title, hint, children, testId }: { icon: typeof FileTextIcon; title: string; hint?: string; children: React.ReactNode; testId?: string }) {
	const [open, setOpen] = useState(false);
	return (
		<section className="space-y-2" data-testid={testId}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm hover:bg-accent pointer-coarse:min-h-11"
			>
				<Icon className="size-4 text-muted-foreground" />
				<span className="font-medium">{title}</span>
				{hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
				<ChevronDownIcon className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
			</button>
			{open && children}
		</section>
	);
}
