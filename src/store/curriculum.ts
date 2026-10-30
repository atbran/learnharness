/**
 * CurriculumStore — fs adapter (implements core/ports.ts CurriculumStore).
 *
 *   curriculum/                       read-only spine (PATHS.curriculumSource)
 *     books.json, physics/program.json, physics/courses/<id>.json
 *   data/curriculum/                  learner state (PATHS.curriculum)
 *     progress.jsonl                  append-only ProgressEvent ledger
 *     settings.json                   CurriculumSettings
 *     <kind>/<id>.json                generated-artifact caches
 *     audio/<file>, uploads/<file>    binary artifacts
 *
 * Same idioms as the graph adapter: sync fs, strict line guards (corrupt
 * or off-schema ledger lines are skipped, never guessed), and an event
 * after every write lands.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import {
	booksCatalogSchema,
	courseChecksSchema,
	courseSchema,
	programSchema,
	progressEventSchema,
	type BooksCatalog,
	type CheckQuestion,
	type Course,
	type Program,
	type ProgressEvent,
} from "../core/contracts/curriculum.ts";
import { emit } from "../core/events.ts";
import type { CacheKind, CurriculumSettings, CurriculumStore } from "../core/ports.ts";

const PROGRAM_DIR = path.join(PATHS.curriculumSource, "physics");
const LEDGER = path.join(PATHS.curriculum, "progress.jsonl");
const SETTINGS = path.join(PATHS.curriculum, "settings.json");
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

function readJson(file: string): unknown {
	return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJsonAtomic(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, "\t"), "utf-8");
	fs.renameSync(tmp, file);
}

function safeId(id: string): string {
	if (!SAFE_ID.test(id) || id.includes("..")) throw new Error(`invalid id: ${id}`);
	return id;
}

// The spine is immutable at runtime except in dev (content edits): cache by
// the newest mtime across its files so edits show up on the next request.
let programCache: { stamp: number; program: Program } | null = null;

function spineStamp(): number {
	let newest = 0;
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(p);
			else newest = Math.max(newest, fs.statSync(p).mtimeMs);
		}
	};
	walk(PATHS.curriculumSource);
	return newest;
}

function loadProgram(): Program {
	const stamp = spineStamp();
	if (programCache && programCache.stamp === stamp) return programCache.program;
	const meta = programSchema.parse(readJson(path.join(PROGRAM_DIR, "program.json")));
	const courseList: Course[] = [];
	for (const id of meta.courses) {
		const file = path.join(PROGRAM_DIR, "courses", `${id}.json`);
		if (!fs.existsSync(file)) continue; // authored incrementally; validate-curriculum reports gaps
		courseList.push(courseSchema.parse(readJson(file)));
	}
	const program: Program = { ...meta, courses: courseList.map((c) => c.id), courseList };
	programCache = { stamp, program };
	return program;
}

function loadCatalog(): BooksCatalog {
	return booksCatalogSchema.parse(readJson(path.join(PATHS.curriculumSource, "books.json")));
}

// Authored checks, keyed by the same spine stamp as the program cache.
let checksCache: { stamp: number; byLesson: Map<string, CheckQuestion[]> } | null = null;

function authoredCheck(lessonId: string): CheckQuestion[] | null {
	const stamp = spineStamp();
	if (!checksCache || checksCache.stamp !== stamp) {
		const byLesson = new Map<string, CheckQuestion[]>();
		const dir = path.join(PROGRAM_DIR, "checks");
		for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")) : []) {
			const parsed = courseChecksSchema.safeParse(readJson(path.join(dir, f)));
			// An invalid file is skipped (validate-checks reports it); the
			// lessons fall back to generated checks rather than breaking.
			if (parsed.success) for (const [lessonId, qs] of Object.entries(parsed.data.checks)) byLesson.set(lessonId, qs as CheckQuestion[]);
		}
		checksCache = { stamp, byLesson };
	}
	return checksCache.byLesson.get(lessonId) ?? null;
}

function readEvents(): ProgressEvent[] {
	let raw: string;
	try {
		raw = fs.readFileSync(LEDGER, "utf-8");
	} catch {
		return [];
	}
	const out: ProgressEvent[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = progressEventSchema.safeParse(JSON.parse(line));
			if (parsed.success) out.push(parsed.data);
		} catch {
			// torn append — skip
		}
	}
	return out;
}

function appendEvent(event: ProgressEvent): void {
	const parsed = progressEventSchema.parse(event);
	fs.mkdirSync(PATHS.curriculum, { recursive: true });
	fs.appendFileSync(LEDGER, `${JSON.stringify(parsed)}\n`, "utf-8");
	emit("curriculum-changed", {});
}

function readSettings(): CurriculumSettings {
	try {
		const raw = readJson(SETTINGS) as Partial<CurriculumSettings>;
		return {
			hoursPerWeek: typeof raw.hoursPerWeek === "number" && raw.hoursPerWeek > 0 ? raw.hoursPerWeek : null,
			startDate: typeof raw.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate) ? raw.startDate : null,
		};
	} catch {
		return { hoursPerWeek: null, startDate: null };
	}
}

function writeSettings(settings: CurriculumSettings): void {
	writeJsonAtomic(SETTINGS, settings);
	emit("curriculum-changed", {});
}

function cacheFile(kind: CacheKind, id: string): string {
	return path.join(PATHS.curriculum, kind, `${safeId(id)}.json`);
}

function readCache<T>(kind: CacheKind, id: string): T | null {
	try {
		return readJson(cacheFile(kind, id)) as T;
	} catch {
		return null;
	}
}

function writeCache(kind: CacheKind, id: string, value: unknown): void {
	writeJsonAtomic(cacheFile(kind, id), value);
	emit("curriculum-changed", {});
}

function listCache(kind: CacheKind): string[] {
	try {
		return fs
			.readdirSync(path.join(PATHS.curriculum, kind))
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.slice(0, -5));
	} catch {
		return [];
	}
}

function artifactPath(kind: "audio" | "uploads", file: string): string {
	const dir = path.join(PATHS.curriculum, kind);
	fs.mkdirSync(dir, { recursive: true });
	return path.join(dir, safeId(file));
}

export const curriculumStore: CurriculumStore = {
	loadProgram,
	loadCatalog,
	authoredCheck,
	readEvents,
	appendEvent,
	readSettings,
	writeSettings,
	readCache,
	writeCache,
	listCache,
	artifactPath,
};
