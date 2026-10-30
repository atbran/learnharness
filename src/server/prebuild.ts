/**
 * A background builder over the program: walks every lesson's items (demo
 * ideas, lesson notes, …) in program order, builds the missing ones a few
 * at a time, so they open instantly when the learner reaches them.
 *
 * The on/off switch and course scope persist in a state file (with the
 * failure counts) and the production server resumes it on start
 * (instrumentation.ts). A failed build is retried once on a later pass. A
 * usage-limit error pauses the whole queue for a while instead of counting
 * as a failure: the subscription comes back on its own.
 */

import * as fs from "node:fs";
import { emit } from "../core/events.ts";
import type { Lesson } from "../core/contracts/curriculum.ts";
import { programIndex } from "./curriculum.ts";

const MAX_ATTEMPTS = 2;
const LIMIT_PAUSE_MS = 30 * 60_000;

/** Errors that mean "out of usage for now", not "this item can't be built". */
const USAGE_LIMIT = /usage limit|rate.?limit|limit reached|hit your limit|too many requests|\b429\b|overloaded|quota/i;

export interface PrebuildSpec {
	/** Process-global slot name (instrumentation and routes are separate bundles). */
	name: string;
	stateFile: string;
	concurrency: number;
	/** How many items a lesson has (its demo ideas, 1 for notes, …). */
	count: (lesson: Lesson) => number;
	/** Cache ids of everything already built, from one directory listing. */
	built: () => Set<string>;
	cacheId: (lessonId: string, i: number) => string;
	/** Build one item; settles when done, a failure is reported by `error`. */
	build: (lessonId: string, i: number) => Promise<void>;
	error: (lessonId: string, i: number) => string | null;
	label: (lesson: Lesson, i: number) => string;
}

export interface PrebuildStatus {
	enabled: boolean;
	/** Course codes in scope (empty = all). */
	courses: string[];
	total: number;
	built: number;
	/** Gave up after the retry. */
	failed: number;
	building: { lessonId: string; i: number; title: string }[];
	/** ISO time the queue resumes after a usage limit, if paused. */
	pausedUntil: string | null;
	lastError: string | null;
	/** Workers are running (false once everything left is built or failed). */
	active: boolean;
}

interface SavedState {
	enabled: boolean;
	/** Courses to build for; empty = every course. */
	courses: string[];
	failures: Record<string, { attempts: number; error: string }>;
}

interface Live {
	saved: SavedState;
	workers: number;
	building: Set<string>;
	pausedUntil: number;
	lastError: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (lessonId: string, i: number) => `${lessonId}#${i}`;

export function createPrebuild(spec: PrebuildSpec) {
	const load = (): SavedState => {
		try {
			const raw = JSON.parse(fs.readFileSync(spec.stateFile, "utf8")) as Partial<SavedState>;
			return { enabled: raw.enabled === true, courses: Array.isArray(raw.courses) ? raw.courses : [], failures: raw.failures ?? {} };
		} catch {
			return { enabled: false, courses: [], failures: {} };
		}
	};
	const g = globalThis as unknown as Record<string, Live | undefined>;
	const slot = `__lhPrebuild_${spec.name}`;
	const live = (g[slot] ??= { saved: load(), workers: 0, building: new Set(), pausedUntil: 0, lastError: null });

	const save = () => {
		const tmp = `${spec.stateFile}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(live.saved, null, 2));
		fs.renameSync(tmp, spec.stateFile);
	};

	/** Every item in the chosen courses, in program order. */
	const all = (): { lessonId: string; i: number }[] => {
		const index = programIndex();
		const scope = live.saved.courses;
		return index.lessonOrder.flatMap((lessonId) => {
			const ref = index.lessons.get(lessonId)!;
			if (scope.length && !scope.includes(ref.course.id)) return [];
			return Array.from({ length: spec.count(ref.lesson) }, (_, i) => ({ lessonId, i }));
		});
	};

	/** Unbuilt, not in flight, and never-failed items before the single retry of a failed one. */
	const next = (): { lessonId: string; i: number } | null => {
		let retry: { lessonId: string; i: number } | null = null;
		const built = spec.built();
		for (const d of all()) {
			const k = key(d.lessonId, d.i);
			if (live.building.has(k) || built.has(spec.cacheId(d.lessonId, d.i))) continue;
			const attempts = live.saved.failures[k]?.attempts ?? 0;
			if (attempts === 0) return d;
			if (attempts < MAX_ATTEMPTS) retry ??= d;
		}
		return retry;
	};

	const worker = async (): Promise<void> => {
		live.workers++;
		try {
			while (live.saved.enabled) {
				const wait = live.pausedUntil - Date.now();
				if (wait > 0) {
					await sleep(Math.min(wait, 60_000));
					continue;
				}
				const d = next();
				if (!d) return;
				const k = key(d.lessonId, d.i);
				live.building.add(k);
				emit("curriculum-changed", {});
				try {
					await spec.build(d.lessonId, d.i);
				} catch (err) {
					// The lesson vanished from the curriculum mid-run: nothing to retry.
					live.saved.failures[k] = { attempts: MAX_ATTEMPTS, error: err instanceof Error ? err.message : String(err) };
				} finally {
					live.building.delete(k);
				}
				const error = spec.built().has(spec.cacheId(d.lessonId, d.i)) ? null : spec.error(d.lessonId, d.i);
				if (error && USAGE_LIMIT.test(error)) {
					live.pausedUntil = Date.now() + LIMIT_PAUSE_MS;
					live.lastError = error;
				} else if (error) {
					live.saved.failures[k] = { attempts: (live.saved.failures[k]?.attempts ?? 0) + 1, error };
					live.lastError = error;
				} else {
					delete live.saved.failures[k];
				}
				save();
				emit("curriculum-changed", {});
			}
		} finally {
			live.workers--;
			emit("curriculum-changed", {});
		}
	};

	// Start the missing workers once each. (A worker with nothing to build
	// finishes synchronously, so re-checking the count would spin forever.)
	const start = () => {
		for (let n = live.workers; n < spec.concurrency; n++) void worker();
	};

	const status = (): PrebuildStatus => {
		const items = all();
		const index = programIndex();
		const done = spec.built();
		const isBuilt = (d: { lessonId: string; i: number }) => done.has(spec.cacheId(d.lessonId, d.i));
		return {
			enabled: live.saved.enabled,
			courses: live.saved.courses.map((id) => index.courses.get(id)?.code ?? id),
			total: items.length,
			built: items.filter(isBuilt).length,
			failed: items.filter((d) => (live.saved.failures[key(d.lessonId, d.i)]?.attempts ?? 0) >= MAX_ATTEMPTS && !isBuilt(d)).length,
			building: [...live.building].map((k) => {
				const [lessonId, i] = k.split("#") as [string, string];
				const lesson = index.lessons.get(lessonId)?.lesson;
				return { lessonId, i: Number(i), title: lesson ? spec.label(lesson, Number(i)) : lessonId };
			}),
			pausedUntil: live.pausedUntil > Date.now() ? new Date(live.pausedUntil).toISOString() : null,
			lastError: live.lastError,
			active: live.workers > 0,
		};
	};

	return {
		/** Called once when the production server starts. */
		resume(): void {
			if (live.saved.enabled) start();
		},
		set(enabled: boolean, opts: { retryFailed?: boolean; courses?: string[] } = {}): PrebuildStatus {
			live.saved.enabled = enabled;
			if (opts.courses) live.saved.courses = opts.courses.filter((id) => programIndex().courses.has(id));
			if (opts.retryFailed) live.saved.failures = {};
			if (enabled) live.pausedUntil = 0;
			save();
			if (enabled) start();
			emit("curriculum-changed", {});
			return status();
		},
		status,
	};
}
