/**
 * Flashcards (pure): the definitions and equations worth memorizing, one deck
 * per lesson — written by the card writer, plus the learner's own — on an
 * Anki-style schedule (Again / Hard / Good / Easy). A lesson's cards join the
 * reviews once the lesson is started. Replayed from the progress ledger's
 * card_* events; they never touch mastery, pace or XP.
 */

import type { ProgressEvent } from "./contracts/curriculum.ts";
import { addDays, isoDate } from "./progress.ts";

export type CardRating = "again" | "hard" | "good" | "easy";
export const CARD_RATINGS: readonly CardRating[] = ["again", "hard", "good", "easy"];

export interface FlashcardDraft {
	kind: "definition" | "equation" | "fact";
	/** Markdown with $…$ / $$…$$ math. */
	front: string;
	back: string;
}

export interface CardSchedule {
	reps: number;
	lapses: number;
	ease: number;
	intervalDays: number;
	due: string; // yyyy-mm-dd
}

export interface Flashcard extends FlashcardDraft {
	id: string;
	lessonId: string;
	/** Written by the learner (removing deletes it) vs the card writer (removing hides it). */
	own: boolean;
	removed: boolean;
	/** null until first studied: a new card. */
	schedule: CardSchedule | null;
}

export interface Deck {
	cards: Flashcard[];
	/** Card ids to study today, in lesson order: due reviews first, then new cards. */
	due: string[];
}

/** A generated card's id: stable as long as the lesson's deck isn't rewritten. */
export const generatedCardId = (lessonId: string, i: number) => `${lessonId}~${i}`;

const MIN_EASE = 1.3;

/** One graded flip on `date`. Again keeps the card due today (it comes
 *  back later in the session); a new card's first Good is a day, then
 *  3 days, then the interval times its ease. */
export function nextCardSchedule(prev: CardSchedule | null, rating: CardRating, date: string): CardSchedule {
	const p = prev ?? { reps: 0, lapses: 0, ease: 2.5, intervalDays: 0, due: date };
	if (rating === "again") return { reps: 0, lapses: p.lapses + (p.reps > 0 ? 1 : 0), ease: Math.max(MIN_EASE, p.ease - 0.2), intervalDays: 0, due: date };
	const ease = Math.max(MIN_EASE, p.ease + (rating === "hard" ? -0.15 : rating === "easy" ? 0.15 : 0));
	const good = p.reps === 0 ? 1 : p.reps === 1 ? 3 : Math.round(p.intervalDays * p.ease);
	const intervalDays =
		rating === "hard" ? Math.max(1, Math.round(Math.max(p.intervalDays, 1) * 1.2)) : rating === "easy" ? Math.max(4, Math.round(good * 1.3)) : Math.max(1, good);
	return { reps: p.reps + 1, lapses: p.lapses, ease, intervalDays, due: addDays(date, intervalDays) };
}

/** The deck: generated cards (by lesson) and the learner's own, replayed
 *  through the ledger. `started` lessons' cards are the ones due. */
export function deriveDeck(
	lessonOrder: readonly string[],
	generated: ReadonlyMap<string, FlashcardDraft[]>,
	events: readonly ProgressEvent[],
	started: ReadonlySet<string>,
	now: Date,
): Deck {
	const today = isoDate(now);
	const cards = new Map<string, Flashcard>();
	for (const lessonId of lessonOrder)
		(generated.get(lessonId) ?? []).forEach((d, i) => {
			const id = generatedCardId(lessonId, i);
			cards.set(id, { ...d, id, lessonId, own: false, removed: false, schedule: null });
		});
	const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
	for (const ev of sorted) {
		switch (ev.type) {
			case "card_added":
				cards.set(ev.cardId, { kind: "fact", front: ev.front, back: ev.back, id: ev.cardId, lessonId: ev.lessonId, own: true, removed: false, schedule: null });
				break;
			case "card_removed": {
				const c = cards.get(ev.cardId);
				if (c?.own) cards.delete(ev.cardId);
				else if (c) c.removed = true;
				break;
			}
			case "card_restored": {
				const c = cards.get(ev.cardId);
				if (c) c.removed = false;
				break;
			}
			case "card_review": {
				const c = cards.get(ev.cardId);
				if (c) c.schedule = nextCardSchedule(c.schedule, ev.rating, isoDate(ev.at));
				break;
			}
		}
	}
	const order = new Map(lessonOrder.map((id, i) => [id, i]));
	const list = [...cards.values()].sort((a, b) => (order.get(a.lessonId) ?? 0) - (order.get(b.lessonId) ?? 0));
	const live = list.filter((c) => !c.removed && started.has(c.lessonId));
	const due = [...live.filter((c) => c.schedule && c.schedule.due <= today), ...live.filter((c) => !c.schedule)].map((c) => c.id);
	return { cards: list, due };
}

/** How long each rating would put the card away, for the buttons ("1d", "3d", "now"). */
export function ratingPreview(schedule: CardSchedule | null, date: string): Record<CardRating, string> {
	const out = {} as Record<CardRating, string>;
	for (const r of CARD_RATINGS) {
		const d = nextCardSchedule(schedule, r, date).intervalDays;
		out[r] = d === 0 ? "now" : d < 31 ? `${d}d` : d < 365 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`;
	}
	return out;
}
