/**
 * flashcards — the Again/Hard/Good/Easy schedule and the deck replayed from
 * the ledger: own cards, removals, restores, and which cards are due.
 */
import assert from "node:assert";
import test from "node:test";
import type { ProgressEvent } from "../src/core/contracts/curriculum.ts";
import { deriveDeck, generatedCardId, nextCardSchedule, ratingPreview, type FlashcardDraft } from "../src/core/flashcards.ts";

const day = "2026-10-01";
const at = (date: string, h = 12) => `${date}T${String(h).padStart(2, "0")}:00:00`;
const draft = (front: string): FlashcardDraft => ({ kind: "definition", front, back: `${front} means…` });

test("a new card: Good is a day, then 3 days, then interval × ease", () => {
	const s1 = nextCardSchedule(null, "good", day);
	assert.deepStrictEqual([s1.intervalDays, s1.due], [1, "2026-10-02"]);
	const s2 = nextCardSchedule(s1, "good", "2026-10-02");
	assert.strictEqual(s2.intervalDays, 3);
	const s3 = nextCardSchedule(s2, "good", "2026-10-05");
	assert.strictEqual(s3.intervalDays, Math.round(3 * 2.5));
});

test("Again keeps the card due today, resets it, lowers its ease and counts a lapse once learned", () => {
	const learned = nextCardSchedule(nextCardSchedule(null, "good", day), "good", "2026-10-02");
	const again = nextCardSchedule(learned, "again", "2026-10-05");
	assert.deepStrictEqual([again.intervalDays, again.due, again.reps, again.lapses], [0, "2026-10-05", 0, 1]);
	assert.ok(again.ease < learned.ease);
	assert.strictEqual(nextCardSchedule(null, "again", day).lapses, 0);
});

test("Hard < Good < Easy, and ease never drops below 1.3", () => {
	const p = ratingPreview(null, day);
	assert.deepStrictEqual(p, { again: "now", hard: "1d", good: "1d", easy: "4d" });
	let s = nextCardSchedule(null, "good", day);
	for (let i = 0; i < 20; i++) s = nextCardSchedule(s, "again", day);
	assert.strictEqual(s.ease, 1.3);
});

test("only started lessons' cards are due: reviews first, then new; removed and future cards are not", () => {
	const generated = new Map([
		["l1", [draft("a"), draft("b")]],
		["l2", [draft("c")]],
	]);
	const events: ProgressEvent[] = [
		{ type: "card_review", at: at(day), cardId: generatedCardId("l1", 1), rating: "good" },
		{ type: "card_removed", at: at(day), cardId: generatedCardId("l1", 0) },
	];
	const started = new Set(["l1"]);
	// The day after: l1~1 is due again, l1~0 is removed, l2 isn't started.
	assert.deepStrictEqual(deriveDeck(["l1", "l2"], generated, events, started, new Date(at("2026-10-02"))).due, ["l1~1"]);
	assert.deepStrictEqual(deriveDeck(["l1", "l2"], generated, events, started, new Date(at(day, 18))).due, []);
	const restored = [...events, { type: "card_restored", at: at(day, 13), cardId: "l1~0" } as ProgressEvent];
	assert.deepStrictEqual(deriveDeck(["l1", "l2"], generated, restored, new Set(["l1", "l2"]), new Date(at("2026-10-02"))).due, ["l1~1", "l1~0", "l2~0"]);
});

test("own cards join their lesson's deck; removing one deletes it", () => {
	const added: ProgressEvent = { type: "card_added", at: at(day), cardId: "own-1", lessonId: "l1", front: "pH", back: "$-\\log_{10}[H^+]$" };
	const deck = deriveDeck(["l1"], new Map(), [added], new Set(["l1"]), new Date(at(day, 13)));
	assert.deepStrictEqual([deck.cards[0]!.own, deck.due], [true, ["own-1"]]);
	const gone = deriveDeck(["l1"], new Map(), [added, { type: "card_removed", at: at(day, 14), cardId: "own-1" }], new Set(["l1"]), new Date(at(day, 15)));
	assert.strictEqual(gone.cards.length, 0);
});
