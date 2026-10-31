"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, Layers3Icon, Loader2Icon, PartyPopperIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { CARD_RATINGS, nextCardSchedule, ratingPreview, type CardRating, type CardSchedule, type Flashcard } from "@/src/core";
import { TRACK_COLOR } from "./status";

interface LessonMeta {
	title: string;
	unitId: string;
	courseId: string;
	courseCode: string;
	courseTitle: string;
	track: keyof typeof TRACK_COLOR;
}

export interface DeckData {
	cards: Flashcard[];
	due: string[];
	previews: Record<string, Record<CardRating, string>>;
	lessons: Record<string, LessonMeta>;
}

const RATING_LABEL: Record<CardRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const RATING_STYLE: Record<CardRating, string> = {
	again: "border-destructive/60 text-destructive",
	hard: "border-[var(--st-progress)] text-[var(--st-progress)]",
	good: "border-[var(--st-mastered)] text-[var(--st-mastered)]",
	easy: "border-[var(--st-available)] text-[var(--st-available)]",
};

/** The deck, refetched whenever the ledger or a deck changes. */
export function useDeck() {
	const [deck, setDeck] = useState<DeckData | null>(null);
	const load = useCallback(() => {
		void fetch("/api/program/flashcards", { cache: "no-store" })
			.then((r) => r.json())
			.then(setDeck);
	}, []);
	useEffect(load, [load]);
	useServerEvent("curriculum-changed", load);
	return { deck, reload: load };
}

const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A study session over today's due cards: flip, then Again / Hard / Good /
 *  Easy. Again sends the card to the back of this session's queue. The
 *  queue is fixed when the session starts, so ledger refreshes don't reshuffle it. */
export function FlashcardStudy({ deck, onDone }: { deck: DeckData; onDone?: () => void }) {
	const [queue, setQueue] = useState<string[]>(() => deck.due);
	const [schedules, setSchedules] = useState<Record<string, CardSchedule | null>>({});
	const [flipped, setFlipped] = useState(false);
	const [studied, setStudied] = useState(0);
	const byId = useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck.cards]);
	const card = queue[0] ? byId.get(queue[0]) : undefined;
	const schedule = card ? (card.id in schedules ? schedules[card.id]! : card.schedule) : null;
	const previews = card ? ratingPreview(schedule, today()) : null;

	const rate = (rating: CardRating) => {
		if (!card) return;
		void fetch("/api/program/flashcards/review", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cardId: card.id, rating }),
		});
		setSchedules((s) => ({ ...s, [card.id]: nextCardSchedule(schedule, rating, today()) }));
		setQueue((q) => (rating === "again" ? [...q.slice(1), q[0]!] : q.slice(1)));
		setStudied((n) => n + 1);
		setFlipped(false);
	};

	useEffect(() => {
		if (!card && studied > 0) onDone?.();
	}, [card]);

	if (!card) {
		return (
			<div className="rounded-xl border border-border bg-card p-8 text-center" data-testid="flashcards-done">
				<PartyPopperIcon className="mx-auto size-8 text-[var(--st-review)]" />
				<p className="mt-3 text-sm text-muted-foreground">
					{studied ? `Done: ${studied} flip${studied === 1 ? "" : "s"}.` : "No flashcards due."} Cards come back on a spaced schedule, and a lesson's cards join when you start it.
				</p>
			</div>
		);
	}
	const meta = deck.lessons[card.lessonId];
	return (
		<div className="space-y-3" data-testid="flashcard-study">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				{meta && (
					<Link href={`/program/lesson/${card.lessonId}`} className="truncate hover:text-foreground">
						<span style={{ color: TRACK_COLOR[meta.track] }}>{meta.courseCode}</span> · {meta.title}
					</Link>
				)}
				<span className="ml-auto shrink-0 tabular-nums">{queue.length} left</span>
			</div>
			<button
				type="button"
				onClick={() => setFlipped((f) => !f)}
				className="block min-h-56 w-full rounded-xl border border-border bg-card p-6 text-left hover:bg-accent/40"
				aria-label={flipped ? "Show the front" : "Show the answer"}
			>
				<div className="lh-prose text-lg">
					<MessageResponse>{card.front}</MessageResponse>
				</div>
				{flipped ? (
					<div className="lh-prose mt-4 border-t border-border pt-4">
						<MessageResponse>{card.back}</MessageResponse>
					</div>
				) : (
					<p className="mt-6 text-xs text-muted-foreground">Tap to show the answer</p>
				)}
			</button>
			{flipped && previews && (
				<div className="grid grid-cols-4 gap-2">
					{CARD_RATINGS.map((r) => (
						<button
							key={r}
							type="button"
							onClick={() => rate(r)}
							className={cn("flex flex-col items-center rounded-lg border bg-card px-2 py-2 text-sm hover:bg-accent pointer-coarse:min-h-11", RATING_STYLE[r])}
						>
							{RATING_LABEL[r]}
							<span className="text-[11px] text-muted-foreground">{previews[r]}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** /program/flashcards: study what's due, browse every deck, add or remove cards. */
export function FlashcardsPage() {
	const { deck } = useDeck();
	const [studying, setStudying] = useState(false);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span>Flashcards</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl space-y-5 px-6 py-6 max-sm:px-4">
					{!deck ? (
						<Loader2Icon className="size-4 animate-spin text-muted-foreground" />
					) : studying ? (
						<>
							<FlashcardStudy deck={deck} />
							<button type="button" onClick={() => setStudying(false)} className="w-full rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent pointer-coarse:min-h-11">
								Back to the decks
							</button>
						</>
					) : (
						<>
							<section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 font-semibold">
										<Layers3Icon className="size-4" /> {deck.due.length} card{deck.due.length === 1 ? "" : "s"} due
									</div>
									<p className="mt-1 text-sm text-muted-foreground">
										Definitions and equations to memorize. A lesson&apos;s cards join when you start it; each flip sets how soon the card comes back.
									</p>
								</div>
								<button
									type="button"
									disabled={deck.due.length === 0}
									onClick={() => setStudying(true)}
									className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-11"
								>
									Study now
								</button>
							</section>
							<DeckList deck={deck} />
						</>
					)}
				</div>
			</div>
		</div>
	);
}

/** Every deck by course, then lesson. */
function DeckList({ deck }: { deck: DeckData }) {
	const courses = new Map<string, { code: string; title: string; track: LessonMeta["track"]; lessons: string[] }>();
	for (const c of deck.cards) {
		const m = deck.lessons[c.lessonId];
		if (!m) continue;
		const course = courses.get(m.courseId) ?? { code: m.courseCode, title: m.courseTitle, track: m.track, lessons: [] };
		if (!course.lessons.includes(c.lessonId)) course.lessons.push(c.lessonId);
		courses.set(m.courseId, course);
	}
	if (courses.size === 0) return <p className="text-sm text-muted-foreground">No decks yet. They&apos;re written as lessons are built, or when you open a lesson.</p>;
	return (
		<div className="space-y-4">
			{[...courses.entries()].map(([id, c]) => (
				<section key={id} className="space-y-2">
					<h2 className="text-sm font-semibold">
						<span style={{ color: TRACK_COLOR[c.track] }}>{c.code}</span> {c.title}
					</h2>
					{c.lessons.map((lessonId) => (
						<LessonDeck key={lessonId} deck={deck} lessonId={lessonId} title={deck.lessons[lessonId]!.title} />
					))}
				</section>
			))}
		</div>
	);
}

/** One lesson's cards: expandable, with remove/restore and an add form. */
export function LessonDeck({ deck, lessonId, title, defaultOpen }: { deck: DeckData; lessonId: string; title?: string; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(!!defaultOpen);
	const cards = deck.cards.filter((c) => c.lessonId === lessonId);
	const live = cards.filter((c) => !c.removed);
	const due = live.filter((c) => deck.due.includes(c.id)).length;
	return (
		<div className="rounded-xl border border-border bg-card">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-accent/40 pointer-coarse:min-h-11"
			>
				<span className="min-w-0 flex-1 truncate">{title ?? "Flashcards"}</span>
				<span className="shrink-0 text-xs text-muted-foreground">
					{live.length} card{live.length === 1 ? "" : "s"}
					{due ? ` · ${due} due` : ""}
				</span>
				<ChevronDownIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
			</button>
			{open && (
				<div className="space-y-2 border-t border-border px-4 py-3">
					{cards.map((c) => (
						<CardRow key={c.id} card={c} />
					))}
					<AddCard lessonId={lessonId} />
				</div>
			)}
		</div>
	);
}

function CardRow({ card }: { card: Flashcard }) {
	const toggle = () =>
		void fetch(`/api/program/flashcards/${encodeURIComponent(card.id)}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ removed: !card.removed }),
		});
	return (
		<div className={cn("flex items-start gap-3 rounded-lg border border-border p-3 text-sm max-sm:flex-col", card.removed && "opacity-50")}>
			<div className="lh-prose min-w-0 flex-1">
				<MessageResponse>{card.front}</MessageResponse>
			</div>
			<div className="lh-prose min-w-0 flex-1 text-muted-foreground">
				<MessageResponse>{card.back}</MessageResponse>
			</div>
			<button
				type="button"
				onClick={toggle}
				title={card.removed ? "Put back in the deck" : card.own ? "Delete this card" : "Remove from the deck"}
				className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11"
			>
				{card.removed ? <RotateCcwIcon className="size-3.5" /> : <Trash2Icon className="size-3.5" />}
				{card.removed ? "Restore" : "Remove"}
			</button>
		</div>
	);
}

function AddCard({ lessonId }: { lessonId: string }) {
	const [open, setOpen] = useState(false);
	const [front, setFront] = useState("");
	const [back, setBack] = useState("");
	const [busy, setBusy] = useState(false);
	const save = async () => {
		setBusy(true);
		try {
			const r = await fetch("/api/program/flashcards", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ lessonId, front, back }),
			});
			if (r.ok) {
				setFront("");
				setBack("");
				setOpen(false);
			}
		} finally {
			setBusy(false);
		}
	};
	if (!open)
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11"
			>
				<PlusIcon className="size-3.5" /> Add a card
			</button>
		);
	const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
	return (
		<div className="space-y-2 rounded-lg border border-border p-3" data-testid="add-card">
			<textarea value={front} onChange={(e) => setFront(e.target.value)} rows={2} placeholder="Front: a term, or what an equation is called" className={field} />
			<textarea value={back} onChange={(e) => setBack(e.target.value)} rows={3} placeholder="Back: the definition or equation ($…$ for math)" className={field} />
			<div className="flex gap-2">
				<button
					type="button"
					disabled={busy || !front.trim() || !back.trim()}
					onClick={() => void save()}
					className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-11"
				>
					Add card
				</button>
				<button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent pointer-coarse:min-h-11">
					Cancel
				</button>
			</div>
		</div>
	);
}

/** The lesson page's flashcards: its deck (written on first visit if the
 *  background build hasn't reached it) with add/remove. */
export function LessonFlashcards({ lessonId }: { lessonId: string }) {
	const { deck } = useDeck();
	const [status, setStatus] = useState<{ status: string; error?: string } | null>(null);
	const load = useCallback(() => {
		void fetch(`/api/program/flashcards/lesson/${lessonId}`, { cache: "no-store" })
			.then((r) => r.json())
			.then(setStatus);
	}, [lessonId]);
	useEffect(load, [load]);
	useServerEvent("curriculum-changed", () => {
		if (status?.status !== "ready") load();
	});
	useEffect(() => {
		if (status?.status === "missing")
			void fetch(`/api/program/flashcards/lesson/${lessonId}`, { method: "POST" })
				.then((r) => r.json())
				.then(setStatus);
	}, [status?.status, lessonId]);

	if (!deck || !status) return null;
	return (
		<section className="space-y-2" data-testid="lesson-flashcards">
			<h2 className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
				<Layers3Icon className="size-3.5" /> Flashcards
				<Link href="/program/flashcards" className="ml-auto normal-case tracking-normal hover:text-foreground hover:underline">
					All decks →
				</Link>
			</h2>
			{status.status === "writing" && (
				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2Icon className="size-4 animate-spin" /> Writing this lesson&apos;s flashcards… (about half a minute, once)
				</p>
			)}
			{status.status === "error" && <p className="text-sm text-destructive">{status.error}</p>}
			<LessonDeck deck={deck} lessonId={lessonId} title="This lesson's cards" />
		</section>
	);
}

/** The program home's link to the flashcards, with today's due count. */
export function FlashcardsDue() {
	const { deck } = useDeck();
	return deck && deck.due.length > 0 ? <span className="rounded-full bg-[var(--st-review)] px-1.5 text-[10px] font-medium text-background">{deck.due.length}</span> : null;
}
