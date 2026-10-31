/**
 * Flashcards: each lesson's generated deck (definitions, equations, facts to
 * memorize) is written once by the card writer and cached as
 * data/curriculum/flashcards/<lessonId>.json; the learner's own cards,
 * removals and every graded flip live in the progress ledger. A background
 * builder writes decks ahead (data/curriculum/flashcards-prebuild.json).
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { writeFlashcards } from "../agent/subagents/program-writers.ts";
import { deriveDeck, ratingPreview, type CardRating, type Deck, type FlashcardDraft } from "../core/flashcards.ts";
import { isoDate } from "../core/progress.ts";
import { lessonContext, runTask, taskStatus, writerDeps } from "./assessments.ts";
import { programIndex, progressSnapshot, recordProgress } from "./curriculum.ts";
import { createPrebuild, type PrebuildStatus } from "./prebuild.ts";
import { stores } from "./stores.ts";

interface LessonDeck {
	cards: FlashcardDraft[];
	createdAt: string;
}

const taskId = (lessonId: string) => `flashcards:${lessonId}`;
const readLessonDeck = (lessonId: string) => stores.curriculumStore.readCache<LessonDeck>("flashcards", lessonId);

/** The whole deck, with what's due today and each due card's button intervals. */
export function deckView(now = new Date()): Deck & { previews: Record<string, Record<CardRating, string>> } {
	const index = programIndex();
	const generated = new Map<string, FlashcardDraft[]>();
	for (const lessonId of stores.curriculumStore.listCache("flashcards")) {
		const deck = readLessonDeck(lessonId);
		if (deck && index.lessons.has(lessonId)) generated.set(lessonId, deck.cards);
	}
	const snapshot = progressSnapshot(now);
	const started = new Set(index.lessonOrder.filter((id) => snapshot.lessons[id]?.started || snapshot.lessons[id]?.masteredAt));
	const deck = deriveDeck(index.lessonOrder, generated, stores.curriculumStore.readEvents(), started, now);
	const byId = new Map(deck.cards.map((c) => [c.id, c]));
	const today = isoDate(now);
	return { ...deck, previews: Object.fromEntries(deck.due.map((id) => [id, ratingPreview(byId.get(id)!.schedule, today)])) };
}

export type LessonCardsStatus = { status: "ready" | "writing" | "missing" } | { status: "error"; error: string };

/** Whether a lesson's generated deck exists yet. */
export function lessonCardsStatus(lessonId: string): LessonCardsStatus | null {
	if (!programIndex().lessons.has(lessonId)) return null;
	if (readLessonDeck(lessonId)) return { status: "ready" };
	const t = taskStatus(taskId(lessonId));
	if (t?.status === "running") return { status: "writing" };
	if (t?.status === "error") return { status: "error", error: t.error ?? "the flashcards could not be written" };
	return { status: "missing" };
}

/** Write a lesson's deck in the background unless cached. Settles when done.
 *  Never rewritten: generated card ids are positions in the deck. */
export function ensureFlashcards(lessonId: string): Promise<void> {
	const ref = programIndex().lessons.get(lessonId);
	if (!ref) throw new Error(`unknown lesson ${lessonId}`);
	if (readLessonDeck(lessonId)) return Promise.resolve();
	return runTask(taskId(lessonId), `Writing flashcards · ${ref.lesson.title}`, async () => {
		const cards = await writeFlashcards(ref.lesson, lessonContext(ref.lesson), writerDeps("checkWriter", false));
		stores.curriculumStore.writeCache("flashcards", lessonId, { cards, createdAt: new Date().toISOString() } satisfies LessonDeck);
	});
}

const at = () => new Date().toISOString();

function requireCard(cardId: string) {
	const card = deckView().cards.find((c) => c.id === cardId);
	if (!card) throw new Error(`unknown card ${cardId}`);
	return card;
}

export function addCard(lessonId: string, front: string, back: string): string {
	const cardId = `own-${randomUUID().slice(0, 8)}`;
	recordProgress({ type: "card_added", at: at(), cardId, lessonId, front: front.trim(), back: back.trim() });
	return cardId;
}

export function removeCard(cardId: string): void {
	requireCard(cardId);
	recordProgress({ type: "card_removed", at: at(), cardId });
}

export function restoreCard(cardId: string): void {
	if (!requireCard(cardId).removed) return;
	recordProgress({ type: "card_restored", at: at(), cardId });
}

export function reviewCard(cardId: string, rating: CardRating): void {
	requireCard(cardId);
	recordProgress({ type: "card_review", at: at(), cardId, rating });
}

const decks = createPrebuild({
	name: "flashcards",
	stateFile: path.join(PATHS.curriculum, "flashcards-prebuild.json"),
	concurrency: 2,
	count: () => 1,
	built: () => new Set(stores.curriculumStore.listCache("flashcards")),
	cacheId: (lessonId) => lessonId,
	build: (lessonId) => ensureFlashcards(lessonId),
	error: (lessonId) => {
		const t = taskStatus(taskId(lessonId));
		return t?.status === "error" ? (t.error ?? "the flashcards could not be written") : null;
	},
	label: (lesson) => lesson.title,
});

export type FlashcardsPrebuildStatus = PrebuildStatus;
export const resumeFlashcardsPrebuild = decks.resume;
export const setFlashcardsPrebuild = decks.set;
export const flashcardsPrebuildStatus = decks.status;
