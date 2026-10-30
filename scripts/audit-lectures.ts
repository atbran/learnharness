/**
 * Audit every curated lecture link: YouTube ids are checked through
 * YouTube's oEmbed endpoint (404 = dead/private video; the returned title
 * is printed for eyeballing); other pages must answer 200 and, for OCW-like
 * pages, embed a video. Writes a JSON report.
 *
 *   npx tsx scripts/audit-lectures.ts [courseId] [--out report.json]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { courseSchema } from "../src/core/contracts/curriculum.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "curriculum", "physics", "courses");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1]! : path.resolve("lecture-audit.json");
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");

const YT = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^"'\s]*&)?v=|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

interface Row {
	courseId: string;
	lessonId: string;
	url: string;
	title: string;
	ok: boolean;
	detail: string;
}

async function get(url: string): Promise<{ status: number; body: string }> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 20_000);
	try {
		const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 LearnHarness lecture audit" } });
		return { status: res.status, body: await res.text() };
	} catch (e) {
		return { status: 0, body: String(e) };
	} finally {
		clearTimeout(t);
	}
}

async function check(url: string): Promise<{ ok: boolean; detail: string }> {
	const yt = YT.exec(url)?.[1];
	if (yt) {
		const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`);
		if (r.status !== 200) return { ok: false, detail: `oEmbed ${r.status}` };
		const j = JSON.parse(r.body) as { title?: string; author_name?: string };
		return { ok: true, detail: `${j.author_name ?? "?"}: ${j.title ?? "?"}` };
	}
	if (/youtube\.com\/playlist/.test(url)) {
		const r = await get(url);
		return { ok: r.status === 200, detail: `playlist ${r.status}` };
	}
	if (/\.(mp4|webm|m4v)(\?|$)/i.test(url)) {
		const head = await fetch(url, { method: "HEAD", redirect: "follow" }).catch(() => null);
		return { ok: head?.status === 200, detail: `video file ${head?.status ?? "unreachable"}` };
	}
	const r = await get(url);
	if (r.status !== 200) return { ok: false, detail: `HTTP ${r.status}` };
	const embedded = YT.exec(r.body)?.[1];
	if (embedded) return { ok: true, detail: `page embeds ${embedded}` };
	if (/\.(mp4|webm|m4v)(\?|$)/i.test(url) || /panopto\.com/i.test(url)) return { ok: true, detail: "direct/panopto video" };
	return { ok: true, detail: "page OK, no embedded video (opens externally)" };
}

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".json") && (!only || f === `${only}.json`));
const jobs: Omit<Row, "ok" | "detail">[] = [];
for (const f of files) {
	const course = courseSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")));
	for (const u of course.units) for (const l of u.lessons) for (const lec of l.lectures) jobs.push({ courseId: course.id, lessonId: l.id, url: lec.url, title: lec.title });
}

const unique = [...new Set(jobs.map((j) => j.url))];
const results = new Map<string, { ok: boolean; detail: string }>();
let next = 0;
await Promise.all(
	Array.from({ length: 6 }, async () => {
		while (next < unique.length) {
			const url = unique[next++]!;
			results.set(url, await check(url));
			if (results.size % 50 === 0) console.error(`${results.size}/${unique.length}`);
		}
	}),
);

const rows: Row[] = jobs.map((j) => ({ ...j, ...results.get(j.url)! }));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, "\t"));
const bad = rows.filter((r) => !r.ok);
const external = rows.filter((r) => r.ok && r.detail.startsWith("page OK, no embedded"));
console.log(`${unique.length} unique URLs · ${bad.length} broken links · ${external.length} open externally`);
for (const r of bad) console.log(`BROKEN  ${r.lessonId}  ${r.url}  (${r.detail})`);
console.log(`report: ${out}`);
