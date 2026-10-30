/**
 * Audio guides: spoken walkthroughs of a lesson (written once by the cheap
 * scriptWriter, cached as data/curriculum/audio/<lessonId>.json) or of a
 * finished teaching session's teacher prose, synthesized locally by Kokoro
 * (tts/synth.py in tts/.venv, set up by scripts/setup-tts.ps1) into
 * data/curriculum/audio/<id>.ogg. Generation runs on the program task
 * registry; synth progress streams into the task's label.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { isChatGuideId, teacherSpeech, speakableText } from "../core/audio-guides.ts";
import type { Lesson } from "../core/contracts/curriculum.ts";
import { emit } from "../core/events.ts";
import type { LessonContextData } from "../core/native-messages.ts";
import { writeAudioScript } from "../agent/subagents/program-writers.ts";
import { runTask, taskStatus, writerDeps } from "./assessments.ts";
import { programIndex, resolveReadings } from "./curriculum.ts";
import { stores } from "./stores.ts";

// The file route's Range parsing (app/ reaches core only through barrels).
export { parseRange, type ByteRange } from "../core/audio-guides.ts";

const TTS_DIR =path.join(PATHS.root, "tts");
const PYTHON = path.join(TTS_DIR, ".venv", "Scripts", "python.exe");
const SYNTH = path.join(TTS_DIR, "synth.py");
const MODEL = path.join(TTS_DIR, "models", "kokoro-v1.0.onnx");
const VOICE = "af_heart";
/** Kokoro on CPU runs a few times faster than real time; this is generous. */
const SYNTH_TIMEOUT_MS = 45 * 60_000;

/** data/curriculum/audio/<id>.json */
export interface AudioScript {
	id: string;
	kind: "lesson" | "session";
	title: string;
	subtitle: string;
	createdAt: string;
	voice: string;
	script: string;
}

export interface AudioGuideState {
	id: string;
	kind: "lesson" | "session";
	title: string;
	subtitle: string;
	/** Present once the OGG exists. */
	audio: { bytes: number; updatedAt: string } | null;
	/** Present while a generation task runs. */
	job: { phase: "script" | "synth"; done?: number; total?: number } | null;
	error?: string;
	words?: number;
}

export interface AudioSessionOption {
	id: string;
	title: string;
	updatedAt: string;
	lessonId?: string;
}

// ─── Live job progress (process-global, survives dev HMR) ───────────────────

const g = globalThis as unknown as { __lhAudioJobs?: Map<string, NonNullable<AudioGuideState["job"]>> };
const jobs = (g.__lhAudioJobs ??= new Map());

const taskId = (id: string) => `audio:${id}`;

export function ttsReady(): boolean {
	return fs.existsSync(PYTHON) && fs.existsSync(MODEL);
}

function audioFileOf(id: string): string {
	return stores.curriculumStore.artifactPath("audio", `${id}.ogg`);
}

/** The OGG for a guide, or null when it hasn't been generated. */
export function audioFilePath(id: string): string | null {
	try {
		const p = audioFileOf(id);
		return fs.existsSync(p) ? p : null;
	} catch {
		return null; // invalid id
	}
}

// ─── Metadata ───────────────────────────────────────────────────────────────

function lessonMeta(lessonId: string): { title: string; subtitle: string; lesson: Lesson } | null {
	const ref = programIndex().lessons.get(lessonId);
	return ref ? { title: ref.lesson.title, subtitle: `${ref.course.code} · ${ref.unit.title}`, lesson: ref.lesson } : null;
}

function sessionLessonId(chatId: string): string | undefined {
	for (const m of stores.chatStore.getChat(chatId)?.messages ?? [])
		if (m.role === "custom" && m.customType === "lesson-context") return (m.details as LessonContextData | undefined)?.lessonId;
	return undefined;
}

function sessionMeta(chatId: string): { title: string; subtitle: string } | null {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return null;
	const lessonId = sessionLessonId(chatId);
	const lesson = lessonId ? lessonMeta(lessonId) : null;
	return { title: chat.title, subtitle: lesson ? `Teaching session · ${lesson.subtitle}` : "Teaching session" };
}

function lessonContext(lesson: Lesson): string {
	const ref = programIndex().lessons.get(lesson.id)!;
	const readings = resolveReadings(lesson)
		.map((r) => `${r.label}${r.pages ? ` (pp. ${r.pages})` : ""}`)
		.join("; ");
	return `Course ${ref.course.code} ${ref.course.title} · Unit: ${ref.unit.title} — ${ref.unit.summary}${readings ? `\nAssigned reading: ${readings}` : ""}`;
}

// ─── Views ──────────────────────────────────────────────────────────────────

export function audioGuideState(id: string): AudioGuideState | null {
	const meta = isChatGuideId(id) ? sessionMeta(id) : lessonMeta(id);
	const cached = stores.curriculumStore.readCache<AudioScript>("audio", id);
	if (!meta && !cached) return null;
	const file = audioFilePath(id);
	const stat = file ? fs.statSync(file) : null;
	const task = taskStatus(taskId(id));
	return {
		id,
		kind: isChatGuideId(id) ? "session" : "lesson",
		title: meta?.title ?? cached!.title,
		subtitle: meta?.subtitle ?? cached!.subtitle,
		audio: stat ? { bytes: stat.size, updatedAt: stat.mtime.toISOString() } : null,
		job: task?.status === "running" ? (jobs.get(id) ?? { phase: "script" }) : null,
		error: task?.status === "error" ? task.error : undefined,
		words: cached ? cached.script.split(/\s+/).filter(Boolean).length : undefined,
	};
}

/** One guide with its script text (the page's focused view). */
export function audioGuide(id: string): (AudioGuideState & { script: string | null }) | null {
	const state = audioGuideState(id);
	if (!state) return null;
	return { ...state, script: stores.curriculumStore.readCache<AudioScript>("audio", id)?.script ?? null };
}

/** Every guide that has a script, audio, or a running job — plus the
 *  teaching sessions that could become one. */
export function audioGuides(): { ttsReady: boolean; guides: AudioGuideState[]; sessions: AudioSessionOption[] } {
	const ids = new Set(stores.curriculumStore.listCache("audio"));
	for (const id of jobs.keys()) ids.add(id);
	try {
		for (const f of fs.readdirSync(path.dirname(audioFileOf("x")))) if (f.endsWith(".ogg")) ids.add(f.slice(0, -4));
	} catch {
		// no audio dir yet
	}
	const guides = [...ids].map(audioGuideState).filter((s): s is AudioGuideState => s !== null);
	const sessions = stores.chatStore
		.listChats()
		.filter((c) => c.kind === "teach" && c.messageCount > 2)
		.slice(0, 40)
		.filter((c) => ids.has(c.id) || teacherSpeech(stores.chatStore.getChat(c.id)?.messages ?? []).trim() !== "")
		.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, lessonId: sessionLessonId(c.id) }));
	return { ttsReady: ttsReady(), guides, sessions };
}

// ─── Generation ─────────────────────────────────────────────────────────────

/** Lesson guide: write the script once (cached), then synthesize. `rewrite`
 *  discards the cached script; `resynth` re-renders an existing OGG. */
export function ensureLessonAudio(lessonId: string, opts: { rewrite?: boolean; resynth?: boolean } = {}): void {
	const meta = lessonMeta(lessonId);
	if (!meta) throw new Error(`unknown lesson ${lessonId}`);
	if (!ttsReady()) throw new Error("Local TTS isn't set up yet — run scripts/setup-tts.ps1.");
	if (audioFilePath(lessonId) && !opts.rewrite && !opts.resynth) return;
	runTask(taskId(lessonId), `Audio guide · ${meta.title}`, async () => {
		try {
			let cached = opts.rewrite ? null : stores.curriculumStore.readCache<AudioScript>("audio", lessonId);
			if (!cached) {
				jobs.set(lessonId, { phase: "script" });
				emit("curriculum-changed", {});
				const raw = await writeAudioScript(meta.lesson, lessonContext(meta.lesson), writerDeps("scriptWriter", true));
				cached = { id: lessonId, kind: "lesson", title: meta.title, subtitle: meta.subtitle, createdAt: new Date().toISOString(), voice: VOICE, script: speakableText(raw) };
				stores.curriculumStore.writeCache("audio", lessonId, cached);
			}
			await synthesize(lessonId, cached.script, `Audio guide · ${meta.title}`);
		} finally {
			jobs.delete(lessonId);
		}
	});
}

/** Session guide: the teacher prose of a teaching session, read aloud.
 *  The script is re-derived each time (a session can continue later). */
export function ensureSessionAudio(chatId: string, opts: { resynth?: boolean } = {}): void {
	if (!isChatGuideId(chatId)) throw new Error(`not a session id: ${chatId}`);
	const chat = stores.chatStore.getChat(chatId);
	const meta = sessionMeta(chatId);
	if (!chat || !meta) throw new Error(`unknown session ${chatId}`);
	if (!ttsReady()) throw new Error("Local TTS isn't set up yet — run scripts/setup-tts.ps1.");
	if (audioFilePath(chatId) && !opts.resynth) return;
	const script = teacherSpeech(chat.messages);
	if (!script.trim()) throw new Error("This session has no teacher prose to read yet.");
	runTask(taskId(chatId), `Session audio · ${meta.title}`, async () => {
		try {
			stores.curriculumStore.writeCache("audio", chatId, {
				id: chatId,
				kind: "session",
				title: meta.title,
				subtitle: meta.subtitle,
				createdAt: new Date().toISOString(),
				voice: VOICE,
				script,
			} satisfies AudioScript);
			await synthesize(chatId, script, `Session audio · ${meta.title}`);
		} finally {
			jobs.delete(chatId);
		}
	});
}

/** Text → OGG via tts/synth.py (no shell). Progress lines update the job and
 *  the task label; the last stderr lines become the error on failure. */
function synthesize(id: string, script: string, label: string): Promise<void> {
	const textFile = stores.curriculumStore.artifactPath("audio", `${id}.txt`);
	fs.writeFileSync(textFile, script, "utf-8");
	const out = audioFileOf(id);
	const job: NonNullable<AudioGuideState["job"]> = { phase: "synth" };
	jobs.set(id, job);
	emit("curriculum-changed", {});
	return new Promise<void>((resolve, reject) => {
		const child = spawn(PYTHON, ["-I", SYNTH, textFile, out, "--voice", VOICE], {
			cwd: TTS_DIR,
			shell: false,
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
			env: { ...process.env, PYTHONIOENCODING: "utf-8" },
		});
		const tail: string[] = [];
		let lastEmit = 0;
		let buf = "";
		const timer = setTimeout(() => {
			tail.push(`timed out after ${SYNTH_TIMEOUT_MS / 60_000} min`);
			child.kill();
		}, SYNTH_TIMEOUT_MS);
		child.stderr.setEncoding("utf-8");
		child.stderr.on("data", (chunk: string) => {
			buf += chunk;
			const lines = buf.split(/\r?\n/);
			buf = lines.pop() ?? "";
			for (const line of lines) {
				const m = /^progress (\d+)\/(\d+)$/.exec(line.trim());
				if (!m) {
					if (line.trim()) tail.push(line.trim());
					if (tail.length > 20) tail.shift();
					continue;
				}
				job.done = Number(m[1]);
				job.total = Number(m[2]);
				const task = taskStatus(taskId(id));
				if (task) task.label = `${label} · ${Math.round((100 * job.done) / Math.max(1, job.total))}%`;
				if (Date.now() - lastEmit > 3000 || job.done === job.total) {
					lastEmit = Date.now();
					emit("curriculum-changed", {});
				}
			}
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(new Error(`could not start the TTS process: ${err.message}`));
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			fs.rmSync(textFile, { force: true });
			if (code === 0 && fs.existsSync(out)) {
				emit("curriculum-changed", {});
				resolve();
			} else reject(new Error(`TTS failed (exit ${code}): ${tail.slice(-4).join(" | ") || "no output"}`));
		});
	});
}
