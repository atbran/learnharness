/**
 * Pre-build every lesson demo in the background, two at a time, in program
 * order, so a demo opens instantly when the learner reaches it.
 *
 * The on/off switch persists (data/curriculum/demo-prebuild.json, with the
 * failure counts) and the production server resumes it on start
 * (instrumentation.ts). A failed build is retried once on a later pass. A
 * usage-limit error pauses the whole queue for a while instead of counting
 * as a failure: the subscription comes back on its own.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import { programIndex } from "./curriculum.ts";
import { builtDemos, demoBuildError, demoCacheId, demoTitle, ensureLessonDemo, lessonDemoBuilt } from "./demos.ts";

const CONCURRENCY = 2;
const MAX_ATTEMPTS = 2;
const LIMIT_PAUSE_MS = 30 * 60_000;
const STATE_FILE = path.join(PATHS.curriculum, "demo-prebuild.json");

/** Errors that mean "out of usage for now", not "this demo can't be built". */
const USAGE_LIMIT = /usage limit|rate.?limit|limit reached|hit your limit|too many requests|\b429\b|overloaded|quota/i;

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

// Process-global: instrumentation and the route modules are separate bundles.
const g = globalThis as unknown as { __lhDemoPrebuild?: Live };
const live = (g.__lhDemoPrebuild ??= { saved: load(), workers: 0, building: new Set(), pausedUntil: 0, lastError: null });

function load(): SavedState {
	try {
		const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<SavedState>;
		return { enabled: raw.enabled === true, courses: Array.isArray(raw.courses) ? raw.courses : [], failures: raw.failures ?? {} };
	} catch {
		return { enabled: false, courses: [], failures: {} };
	}
}

function save(): void {
	fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
	const tmp = `${STATE_FILE}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(live.saved, null, 2));
	fs.renameSync(tmp, STATE_FILE);
}

const key = (lessonId: string, i: number) => `${lessonId}#${i}`;

/** Every demo idea in the chosen courses, in program order. */
function allDemos(): { lessonId: string; i: number }[] {
	const index = programIndex();
	const scope = live.saved.courses;
	return index.lessonOrder.flatMap((lessonId) => {
		const ref = index.lessons.get(lessonId)!;
		if (scope.length && !scope.includes(ref.course.id)) return [];
		return ref.lesson.demoIdeas.map((_, i) => ({ lessonId, i }));
	});
}

/** The next demo to build: unbuilt, not in flight, and never-failed ones
 *  before the single retry of a failed one. */
function next(): { lessonId: string; i: number } | null {
	let retry: { lessonId: string; i: number } | null = null;
	const built = builtDemos();
	for (const d of allDemos()) {
		const k = key(d.lessonId, d.i);
		if (live.building.has(k) || built.has(demoCacheId(d.lessonId, d.i))) continue;
		const attempts = live.saved.failures[k]?.attempts ?? 0;
		if (attempts === 0) return d;
		if (attempts < MAX_ATTEMPTS) retry ??= d;
	}
	return retry;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function worker(): Promise<void> {
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
				await ensureLessonDemo(d.lessonId, d.i);
			} catch (err) {
				// The lesson vanished from the curriculum mid-run: nothing to retry.
				live.saved.failures[k] = { attempts: MAX_ATTEMPTS, error: err instanceof Error ? err.message : String(err) };
			} finally {
				live.building.delete(k);
			}
			const error = lessonDemoBuilt(d.lessonId, d.i) ? null : demoBuildError(d.lessonId, d.i);
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
}

function start(): void {
	while (live.workers < CONCURRENCY) void worker();
}

/** Called once when the production server starts. */
export function resumeDemoPrebuild(): void {
	if (live.saved.enabled) start();
}

export function setDemoPrebuild(enabled: boolean, opts: { retryFailed?: boolean; courses?: string[] } = {}): DemoPrebuildStatus {
	live.saved.enabled = enabled;
	if (opts.courses) live.saved.courses = opts.courses.filter((id) => programIndex().courses.has(id));
	if (opts.retryFailed) live.saved.failures = {};
	if (enabled) live.pausedUntil = 0;
	save();
	if (enabled) start();
	emit("curriculum-changed", {});
	return demoPrebuildStatus();
}

export interface DemoPrebuildStatus {
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

export function demoPrebuildStatus(): DemoPrebuildStatus {
	const demos = allDemos();
	const index = programIndex();
	const done = builtDemos();
	const isBuilt = (d: { lessonId: string; i: number }) => done.has(demoCacheId(d.lessonId, d.i));
	return {
		enabled: live.saved.enabled,
		courses: live.saved.courses.map((id) => index.courses.get(id)?.code ?? id),
		total: demos.length,
		built: demos.filter(isBuilt).length,
		failed: demos.filter((d) => (live.saved.failures[key(d.lessonId, d.i)]?.attempts ?? 0) >= MAX_ATTEMPTS && !isBuilt(d)).length,
		building: [...live.building].map((k) => {
			const [lessonId, i] = k.split("#") as [string, string];
			const idea = index.lessons.get(lessonId)?.lesson.demoIdeas[Number(i)] ?? "";
			return { lessonId, i: Number(i), title: demoTitle(idea) };
		}),
		pausedUntil: live.pausedUntil > Date.now() ? new Date(live.pausedUntil).toISOString() : null,
		lastError: live.lastError,
		active: live.workers > 0,
	};
}
