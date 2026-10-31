/**
 * Lecture resolution: a curated lecture URL (YouTube, or a page that embeds
 * one — MIT OCW resource pages, Open Yale, Theoretical Minimum) → an
 * embeddable YouTube id. Page fetches happen once per URL; results (hits
 * and misses) are cached under data/curriculum/lectures/.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { clipTranscript, parseTranscript, type TranscriptLine } from "../core/transcripts.ts";
import type { Lecture } from "../core/contracts/curriculum.ts";
import { stores } from "./stores.ts";

export interface ResolvedLecture extends Lecture {
	youtubeId: string | null;
	/** The playlist id when the URL is a YouTube playlist. */
	playlistId: string | null;
	/** A ready-to-frame player URL (YouTube no-cookie or Panopto embed), or
	 *  null when the lecture can only be opened at its source page. */
	embedUrl: string | null;
	/** A direct video file URL, played with a native <video> element. */
	videoUrl?: string;
}

function embedFor(lecture: Lecture, youtubeId: string | null, playlistId: string | null): string | null {
	const params = new URLSearchParams({ rel: "0", modestbranding: "1" });
	if (lecture.start) params.set("start", String(lecture.start));
	if (lecture.end) params.set("end", String(lecture.end));
	// enablejsapi: the lesson page drives speed and seeking by postMessage.
	if (youtubeId) return `https://www.youtube-nocookie.com/embed/${youtubeId}?${params}&enablejsapi=1`;
	if (playlistId) return `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`;
	// Panopto: Viewer.aspx?id=… has an Embed.aspx twin built for iframes.
	const panopto = /^(https:\/\/[^/]+\.panopto\.com\/Panopto\/Pages\/)Viewer\.aspx\?(?:[^#]*&)?id=([0-9a-f-]{36})/i.exec(lecture.url);
	if (panopto) return `${panopto[1]}Embed.aspx?id=${panopto[2]}&autoplay=false`;
	return null;
}

interface CachedResolution {
	url: string;
	youtubeId: string | null;
	checkedAt: string;
}

const YT_ID = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^"'\s]*&)?v=|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function youtubeIdFromUrl(url: string): string | null {
	return YT_ID.exec(url)?.[1] ?? null;
}

function playlistIdFromUrl(url: string): string | null {
	return /[?&]list=([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? null;
}

async function fetchEmbeddedId(url: string): Promise<string | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 12_000);
	try {
		const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 LearnHarness lecture resolver" } });
		if (!res.ok) return null;
		const html = await res.text();
		return YT_ID.exec(html)?.[1] ?? null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

const inflight = new Map<string, Promise<string | null>>();

export async function resolveLecture(lecture: Lecture): Promise<ResolvedLecture> {
	const direct = youtubeIdFromUrl(lecture.url);
	const playlistId = playlistIdFromUrl(lecture.url);
	// Direct video files (archive.org MIT RES.18-008 etc.) play in a <video>.
	if (/\.(mp4|webm|m4v)(\?|$)/i.test(lecture.url)) return { ...lecture, youtubeId: null, playlistId: null, embedUrl: null, videoUrl: lecture.url.replace(/^http:/, "https:") };
	if (direct || /youtube\.com\/playlist/.test(lecture.url) || /panopto\.com/i.test(lecture.url))
		return { ...lecture, youtubeId: direct, playlistId, embedUrl: embedFor(lecture, direct, playlistId) };
	const key = createHash("sha1").update(lecture.url).digest("hex").slice(0, 20);
	const cached = stores.curriculumStore.readCache<CachedResolution>("lectures", key);
	if (cached && cached.url === lecture.url) return { ...lecture, youtubeId: cached.youtubeId, playlistId, embedUrl: embedFor(lecture, cached.youtubeId, playlistId) };
	let pending = inflight.get(key);
	if (!pending) {
		pending = fetchEmbeddedId(lecture.url).then((youtubeId) => {
			stores.curriculumStore.writeCache("lectures", key, { url: lecture.url, youtubeId, checkedAt: new Date().toISOString() } satisfies CachedResolution);
			return youtubeId;
		});
		inflight.set(key, pending);
		void pending.finally(() => inflight.delete(key));
	}
	const youtubeId = await pending;
	return { ...lecture, youtubeId, playlistId, embedUrl: embedFor(lecture, youtubeId, playlistId) };
}

/** The transcript file key of a direct video file (archive.org MIT videos),
 *  which has no YouTube id to name it by. */
export function videoTranscriptKey(videoUrl: string): string {
	return `v-${createHash("sha1").update(videoUrl.replace(/^http:/, "https:")).digest("hex").slice(0, 16)}`;
}

/** A lecture's transcript, trimmed to its clip, when one was fetched
 *  (data/curriculum/lectures/transcripts/<youtubeId or video key>.txt). */
export async function lectureTranscript(lecture: Lecture): Promise<TranscriptLine[] | null> {
	const { youtubeId, videoUrl } = await resolveLecture(lecture);
	const key = youtubeId ?? (videoUrl ? videoTranscriptKey(videoUrl) : null);
	if (!key) return null;
	try {
		const raw = fs.readFileSync(path.join(/*turbopackIgnore: true*/ PATHS.curriculum, "lectures", "transcripts", `${key}.txt`), "utf-8");
		const lines = clipTranscript(parseTranscript(raw), lecture.start, lecture.end);
		return lines.length ? lines : null;
	} catch {
		return null;
	}
}
