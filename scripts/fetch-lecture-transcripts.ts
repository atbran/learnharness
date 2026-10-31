/**
 * Fetch every curated lecture's length and transcript (YouTube captions via
 * yt-dlp) so the lecture pass can read what each video actually covers.
 *
 *   npx tsx scripts/fetch-lecture-transcripts.ts [--youtube [--cookies-from-browser <browser> | --cookies <cookies.txt>]] [courseId ...]
 *
 * MIT OCW lectures take their captions from OCW itself (the page links a
 * .vtt), which needs no YouTube request. Other YouTube videos go through
 * yt-dlp only with --youtube, one at a time with long pauses: YouTube
 * answers a fast run with a "confirm you're not a bot" block. The learner
 * can run it with their own signed-in browser (--cookies-from-browser,
 * yt-dlp's documented option) or a cookies.txt exported from it (--cookies;
 * Chrome and Edge on Windows encrypt their cookies so yt-dlp can't read
 * them directly); the pace stays the same.
 *
 * Writes data/curriculum/lectures/transcripts/:
 *   <youtubeId>.txt        the transcript in ~30 s chunks, "[mm:ss] text"
 *   <youtubeId>.meta.json  { id, title, channel, duration, chapters, transcript }
 *   index.json             lecture url → { youtubeId, duration, title }
 * Already-fetched videos are skipped, so it can be re-run to resume.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PATHS } from "../config.ts";
import type { Lecture } from "../src/core/contracts/curriculum.ts";
import { resolveLecture } from "../src/server/lectures.ts";

const COURSES = path.join(PATHS.curriculumSource, "physics", "courses");
const OUT = path.join(PATHS.curriculum, "lectures", "transcripts");
const ARGS = process.argv.slice(2);
const YOUTUBE = ARGS.includes("--youtube");
const cookieAt = ARGS.indexOf("--cookies-from-browser");
const COOKIES_FROM = cookieAt >= 0 ? ARGS[cookieAt + 1] : undefined;
if (cookieAt >= 0 && !COOKIES_FROM) throw new Error("--cookies-from-browser needs a browser name (chrome, edge, firefox, …)");
const cookieFileAt = ARGS.indexOf("--cookies");
const COOKIES_FILE = cookieFileAt >= 0 ? ARGS[cookieFileAt + 1] : undefined;
if (cookieFileAt >= 0 && !(COOKIES_FILE && fs.existsSync(COOKIES_FILE))) throw new Error(`--cookies needs a cookies.txt that exists (got ${COOKIES_FILE ?? "nothing"})`);
const CONCURRENCY = YOUTUBE ? 1 : 4;
const YOUTUBE_PAUSE_MS = 25_000;
const YT_ID = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^"'\s]*&)?v=|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function findYtDlp(): string {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		const p = dir && path.join(dir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
		if (p && fs.existsSync(p)) return p;
	}
	const winget = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
	if (fs.existsSync(winget))
		for (const d of fs.readdirSync(winget).filter((n) => n.startsWith("yt-dlp.yt-dlp"))) {
			const p = path.join(winget, d, "yt-dlp.exe");
			if (fs.existsSync(p)) return p;
		}
	throw new Error("yt-dlp not found (winget install yt-dlp.yt-dlp)");
}
const YTDLP = findYtDlp();

function run(args: string[]): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile(YTDLP, args, { windowsHide: true, timeout: 180_000, maxBuffer: 1 << 24 }, (err, stdout, stderr) =>
			err ? reject(new Error((stderr || err.message).trim().split("\n").slice(-2).join(" "))) : resolve(stdout),
		),
	);
}

const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** WebVTT (incl. YouTube's rolling auto-captions) → "[mm:ss] text" lines,
 *  ~30 s per line, duplicate rolling lines dropped. */
export function vttToText(vtt: string): string {
	const cues: { t: number; text: string }[] = [];
	for (const block of vtt.split(/\r?\n\r?\n/)) {
		const m = /(\d+):(\d{2}):(\d{2})\.\d{3}\s+-->/.exec(block) ?? /(?:^|\n)()(\d{2}):(\d{2})\.\d{3}\s+-->/.exec(block);
		if (!m) continue;
		const t = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
		const lines = block
			.split(/\r?\n/)
			.filter((l) => !l.includes("-->") && l.trim() && !/^(WEBVTT|Kind:|Language:|\d+$)/.test(l))
			.map((l) => l.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim())
			.filter(Boolean);
		for (const text of lines) if (cues.at(-1)?.text !== text) cues.push({ t, text });
	}
	const out: string[] = [];
	let start = -Infinity;
	let buf: string[] = [];
	const seen = new Set<string>();
	for (const c of cues) {
		if (seen.has(c.text)) continue; // rolling captions repeat the previous line
		seen.add(c.text);
		if (seen.size > 400) seen.clear();
		if (c.t - start >= 30 && buf.length) {
			out.push(`[${stamp(start)}] ${buf.join(" ")}`);
			buf = [];
		}
		if (!buf.length) start = c.t;
		buf.push(c.text);
	}
	if (buf.length) out.push(`[${stamp(start)}] ${buf.join(" ")}`);
	return out.join("\n");
}

async function fetchVideo(id: string): Promise<{ duration: number | null; title: string | null }> {
	const metaFile = path.join(OUT, `${id}.meta.json`);
	if (fs.existsSync(metaFile)) {
		const m = JSON.parse(fs.readFileSync(metaFile, "utf8")) as { duration: number | null; title: string | null };
		return { duration: m.duration, title: m.title };
	}
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-subs-"));
	try {
		const json = await run([
			"--skip-download",
			"--no-simulate",
			"--js-runtimes",
			"node",
			...(COOKIES_FROM ? ["--cookies-from-browser", COOKIES_FROM] : []),
			...(COOKIES_FILE ? ["--cookies", COOKIES_FILE] : []),
			"--write-subs",
			"--write-auto-subs",
			"--sub-langs",
			"en,en-US,en-GB,en-orig",
			"--sub-format",
			"vtt",
			"--no-warnings",
			"--sleep-subtitles",
			"1",
			"-o",
			path.join(tmp, "%(id)s.%(ext)s"),
			"--print",
			"%(.{id,title,channel,duration,chapters})j",
			`https://www.youtube.com/watch?v=${id}`,
		]);
		const meta = JSON.parse(json.trim().split("\n").at(-1)!) as { id: string; title: string; channel: string; duration: number; chapters?: { title: string; start_time: number }[] | null };
		// Prefer human subtitles over auto captions when both exist.
		const subs = fs.readdirSync(tmp).filter((f) => f.endsWith(".vtt"));
		const pick = subs.find((f) => /\.en(-US|-GB)?\.vtt$/.test(f)) ?? subs[0];
		const text = pick ? vttToText(fs.readFileSync(path.join(tmp, pick), "utf8")) : "";
		if (text) fs.writeFileSync(path.join(OUT, `${id}.txt`), text);
		const chapters = (meta.chapters ?? []).map((c) => ({ title: c.title, start: Math.round(c.start_time) }));
		fs.writeFileSync(metaFile, JSON.stringify({ id, title: meta.title, channel: meta.channel, duration: meta.duration ?? null, chapters, transcript: !!text }, null, 1));
		return { duration: meta.duration ?? null, title: meta.title };
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

/** An MIT OCW lecture page → its own caption file (no YouTube request). */
async function fetchOcw(url: string): Promise<{ youtubeId: string | null; duration: number | null; title: string | null } | null> {
	const page = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 LearnHarness lecture pass" } });
	if (!page.ok) return null;
	const html = await page.text();
	const vtt = /["']([^"']+\.vtt)["']/.exec(html)?.[1];
	if (!vtt) return null;
	const youtubeId = /_([A-Za-z0-9_-]{11})\.vtt$/.exec(vtt)?.[1] ?? YT_ID.exec(html)?.[1] ?? null;
	const key = youtubeId ?? Buffer.from(url).toString("base64url").slice(-20);
	const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s*\|\s*MIT OpenCourseWare.*$/, "").trim() ?? null;
	const metaFile = path.join(OUT, `${key}.meta.json`);
	if (fs.existsSync(metaFile)) {
		const m = JSON.parse(fs.readFileSync(metaFile, "utf8")) as { duration: number | null; title: string | null };
		return { youtubeId: key, duration: m.duration, title: m.title };
	}
	const res = await fetch(new URL(vtt, url));
	if (!res.ok) return null;
	const text = await res.text();
	const ends = [...text.matchAll(/-->\s*(\d+):(\d{2}):(\d{2})/g)].map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
	const duration = ends.length ? Math.max(...ends) : null;
	const transcript = vttToText(text);
	if (transcript) fs.writeFileSync(path.join(OUT, `${key}.txt`), transcript);
	fs.writeFileSync(metaFile, JSON.stringify({ id: key, title, channel: "MIT OpenCourseWare", duration, chapters: [], transcript: !!transcript, source: url }, null, 1));
	return { youtubeId: key, duration, title };
}

async function main() {
	fs.mkdirSync(OUT, { recursive: true });
	const only = ARGS.filter((a, i) => !a.startsWith("--") && i !== cookieAt + 1 && i !== cookieFileAt + 1);
	const lectures = new Map<string, Lecture>();
	for (const f of fs.readdirSync(COURSES).filter((n) => n.endsWith(".json"))) {
		if (only.length && !only.includes(f.replace(/\.json$/, ""))) continue;
		const course = JSON.parse(fs.readFileSync(path.join(COURSES, f), "utf8")) as { units: { lessons: { lectures?: Lecture[] }[] }[] };
		for (const u of course.units) for (const l of u.lessons) for (const lec of l.lectures ?? []) lectures.set(lec.url, lec);
	}
	const indexFile = path.join(OUT, "index.json");
	const index: Record<string, { youtubeId: string | null; duration: number | null; title: string | null; error?: string }> = fs.existsSync(indexFile)
		? JSON.parse(fs.readFileSync(indexFile, "utf8"))
		: {};
	const todo = [...lectures.values()];
	let done = 0;
	let failed = 0;
	let blocked = false;
	const worker = async () => {
		for (let lec = todo.shift(); lec && !blocked; lec = todo.shift()) {
			try {
				const prior = index[lec.url];
				if (prior && !prior.error && (prior.duration !== null || !YOUTUBE)) {
					done++;
					continue;
				}
				if (/ocw\.mit\.edu/.test(lec.url)) {
					const ocw = await fetchOcw(lec.url);
					if (ocw) {
						index[lec.url] = ocw;
						if (++done % 25 === 0) console.log(`${done}/${lectures.size} lectures · ${failed} failed`);
						continue;
					}
				}
				const resolved = await resolveLecture(lec);
				if (resolved.youtubeId && !YOUTUBE) {
					// Left for the slow --youtube run.
					index[lec.url] = { youtubeId: resolved.youtubeId, duration: null, title: null };
				} else if (!resolved.youtubeId) {
					index[lec.url] = { youtubeId: null, duration: null, title: null };
				} else {
					let attempt = 0;
					for (;;) {
						try {
							const v = await fetchVideo(resolved.youtubeId);
							index[lec.url] = { youtubeId: resolved.youtubeId, ...v };
							await new Promise((r) => setTimeout(r, YOUTUBE_PAUSE_MS));
							break;
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							if (/not a bot/i.test(msg)) throw new Error("YouTube is blocking requests from this PC for now; try --youtube again later.");
							if (/429|Too Many Requests/i.test(msg) && attempt++ < 3) {
								await new Promise((r) => setTimeout(r, 60_000 * attempt));
								continue;
							}
							throw err;
						}
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				// YouTube's bot block covers every video: stop rather than hammer it.
				if (/blocking requests/.test(msg)) {
					blocked = true;
					console.log(msg);
					break;
				}
				failed++;
				index[lec.url] = { youtubeId: null, duration: null, title: null, error: msg };
			}
			if (++done % 25 === 0) {
				fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
				console.log(`${done}/${lectures.size} lectures · ${failed} failed`);
			}
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
	const withText = Object.values(index).filter((v) => v.youtubeId && fs.existsSync(path.join(OUT, `${v.youtubeId}.txt`))).length;
	console.log(`done: ${lectures.size} lectures · ${withText} with transcripts · ${failed} failed`);
}

if (import.meta.url === `file:///${process.argv[1]!.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("fetch-lecture-transcripts.ts")) await main();
