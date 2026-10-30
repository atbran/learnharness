"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, ExternalLinkIcon, MonitorPlayIcon, ScrollTextIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResolvedLecture {
	source: string;
	title: string;
	url: string;
	start?: number;
	end?: number;
	minutes?: number;
	optional?: boolean;
	youtubeId: string | null;
	playlistId: string | null;
	embedUrl: string | null;
	videoUrl?: string;
}

interface TranscriptLine {
	t: number;
	text: string;
}

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
const SPEED_KEY = "lh-lecture-speed";
const YT_ORIGIN = "https://www.youtube-nocookie.com";
const LISTEN_ID = "lh-lecture";

function readSpeed(): number {
	try {
		const v = Number(window.localStorage.getItem(SPEED_KEY));
		return SPEEDS.includes(v) ? v : 1;
	} catch {
		return 1;
	}
}
function saveSpeed(rate: number): void {
	try {
		window.localStorage.setItem(SPEED_KEY, String(rate));
	} catch {
		/* private mode: the speed lasts this page only */
	}
}

/** The lesson's lecture(s): YouTube / Panopto embed, a native <video>, or a
 *  link out. YouTube and <video> lectures get a remembered playback speed
 *  and, when a transcript was fetched, a clickable transcript. */
export function LecturePlayer({ lessonId, count }: { lessonId: string; count: number }) {
	const [lectures, setLectures] = useState<ResolvedLecture[] | null>(null);
	const [active, setActive] = useState(0);
	const [speed, setSpeed] = useState(1);
	const [time, setTime] = useState(0);
	const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
	const [transcript, setTranscript] = useState<{ key: string; lines: TranscriptLine[] | null } | null>(null);
	const speedRef = useRef(1);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		const s = readSpeed();
		speedRef.current = s;
		setSpeed(s);
	}, []);

	useEffect(() => {
		if (count === 0) return;
		let live = true;
		fetch(`/api/program/lectures?lessonId=${encodeURIComponent(lessonId)}`)
			.then((r) => r.json())
			.then((b: { lectures?: ResolvedLecture[] }) => live && setLectures(b.lectures ?? []))
			.catch(() => live && setLectures([]));
		return () => {
			live = false;
		};
	}, [lessonId, count]);

	const lec = lectures?.[active];
	const ytSrc = lec && !lec.videoUrl && lec.youtubeId && lec.embedUrl?.includes("enablejsapi=1") ? lec.embedUrl : null;
	const transcriptKey = `${lessonId}:${active}`;

	// The transcript of the active lecture (lines index = lesson.lectures index).
	useEffect(() => {
		if (!lectures?.[active]) return;
		let live = true;
		fetch(`/api/program/lectures/transcript?lessonId=${encodeURIComponent(lessonId)}&i=${active}`)
			.then((r) => (r.ok ? r.json() : { lines: null }))
			.then((b: { lines?: TranscriptLine[] | null }) => live && setTranscript({ key: `${lessonId}:${active}`, lines: b.lines?.length ? b.lines : null }))
			.catch(() => live && setTranscript({ key: `${lessonId}:${active}`, lines: null }));
		return () => {
			live = false;
		};
	}, [lectures, active, lessonId]);

	const postYT = useCallback((msg: Record<string, unknown>) => {
		frameRef.current?.contentWindow?.postMessage(JSON.stringify(msg), "*");
	}, []);

	// YouTube: after the iframe loads, ask the player to report its state
	// ("listening"); its infoDelivery events carry currentTime. Speed is set
	// once it answers and again on first play (it can ignore a rate set
	// before the video is cued).
	const listenSrc = ytSrc && loadedSrc === ytSrc ? ytSrc : null;
	useEffect(() => {
		if (!listenSrc) return;
		let ready = false;
		let played = false;
		let tries = 0;
		const listen = () => postYT({ event: "listening", id: LISTEN_ID, channel: "widget" });
		listen();
		const timer = window.setInterval(() => {
			if (ready || ++tries > 40) window.clearInterval(timer);
			else listen();
		}, 250);
		const onMessage = (e: MessageEvent) => {
			if (e.origin !== YT_ORIGIN || e.source !== frameRef.current?.contentWindow) return;
			let msg: unknown;
			try {
				msg = typeof e.data === "string" ? JSON.parse(e.data) : null;
			} catch {
				return;
			}
			if (!msg || typeof msg !== "object") return;
			const setRate = () => postYT({ event: "command", func: "setPlaybackRate", args: [speedRef.current] });
			if (!ready) {
				ready = true;
				window.clearInterval(timer);
				setRate();
			}
			const info = (msg as { info?: unknown }).info;
			if (!info || typeof info !== "object") return;
			const { currentTime, playerState } = info as { currentTime?: unknown; playerState?: unknown };
			if (typeof currentTime === "number") setTime(currentTime);
			if (playerState === 1 && !played) {
				played = true;
				setRate();
			}
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("message", onMessage);
		};
	}, [listenSrc, postYT]);

	const changeSpeed = (rate: number) => {
		speedRef.current = rate;
		setSpeed(rate);
		saveSpeed(rate);
		if (videoRef.current) {
			videoRef.current.defaultPlaybackRate = rate;
			videoRef.current.playbackRate = rate;
		}
		if (ytSrc) postYT({ event: "command", func: "setPlaybackRate", args: [rate] });
	};

	const seek = (t: number) => {
		setTime(t);
		const v = videoRef.current;
		if (v) {
			v.currentTime = t;
			void v.play().catch(() => {});
		} else if (ytSrc) {
			postYT({ event: "command", func: "seekTo", args: [t, true] });
			postYT({ event: "command", func: "playVideo", args: [] });
		}
	};

	const select = (i: number) => {
		setActive(i);
		setTime(0);
	};

	if (count === 0)
		return (
			<div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
				No curated lecture for this lesson yet. Your tutor session and the readings carry it.
			</div>
		);
	if (!lectures) return <div className="aspect-video animate-pulse rounded-xl bg-card" />;
	if (!lec) return null;
	const src = lec.embedUrl;
	const controllable = Boolean(lec.videoUrl || ytSrc);
	const lines = transcript?.key === transcriptKey ? transcript.lines : null;
	return (
		<section className="space-y-2">
			{lec.videoUrl ? (
				<video
					ref={videoRef}
					key={lec.videoUrl}
					src={lec.start || lec.end ? `${lec.videoUrl}#t=${lec.start ?? 0}${lec.end ? `,${lec.end}` : ""}` : lec.videoUrl}
					controls
					playsInline
					preload="metadata"
					onLoadedMetadata={(e) => {
						e.currentTarget.defaultPlaybackRate = speedRef.current;
						e.currentTarget.playbackRate = speedRef.current;
					}}
					onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
					className="aspect-video w-full rounded-xl border border-border bg-black"
				/>
			) : src ? (
				<div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
					<iframe
						ref={frameRef}
						key={src}
						src={src}
						title={lec.title}
						className="size-full"
						onLoad={() => setLoadedSrc(src)}
						// Fullscreen + picture-in-picture are delegated to the embed
						// (iPad: the player's own fullscreen / PiP buttons).
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
						allowFullScreen
						referrerPolicy="strict-origin-when-cross-origin"
					/>
				</div>
			) : (
				<a href={lec.url} target="_blank" rel="noreferrer" className="flex aspect-[21/6] items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm hover:bg-accent">
					<MonitorPlayIcon className="size-5" /> Open “{lec.title}” ({lec.source}) <ExternalLinkIcon className="size-3.5" />
				</a>
			)}
			{controllable && (
				<div role="group" aria-label="Playback speed" className="flex flex-wrap items-center gap-1 text-xs" data-testid="lecture-speed">
					<span className="mr-1 text-muted-foreground">Speed</span>
					{SPEEDS.map((r) => (
						<button
							key={r}
							type="button"
							onClick={() => changeSpeed(r)}
							aria-pressed={speed === r}
							className={cn(
								"rounded-md border px-2 py-0.5 tabular-nums pointer-coarse:min-h-11 pointer-coarse:min-w-11",
								speed === r ? "border-foreground bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground",
							)}
						>
							{r}×
						</button>
					))}
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{lectures.map((l, i) =>
					l.optional ? null : (
						<button
							key={i}
							type="button"
							onClick={() => select(i)}
							className={cn(
								"flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left text-xs pointer-coarse:min-h-11",
								i === active ? "border-foreground bg-accent" : "border-border text-muted-foreground hover:text-foreground",
							)}
						>
							<MonitorPlayIcon className="size-3 shrink-0" />
							<span className="truncate">
								{l.source} — {l.title}
							</span>
							<LectureLength lecture={l} />
						</button>
					),
				)}
				<a href={lec.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">
					source page <ExternalLinkIcon className="size-3" />
				</a>
			</div>
			{lectures.some((l) => l.optional) && (
				<div className="flex flex-wrap items-center gap-2 pt-1">
					<span className="text-[11px] uppercase tracking-wider text-muted-foreground">More lectures (optional)</span>
					{lectures.map((l, i) =>
						l.optional ? (
							<button
								key={i}
								type="button"
								onClick={() => select(i)}
								className={cn(
									"flex max-w-full items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1 text-left text-xs pointer-coarse:min-h-11",
									i === active ? "border-foreground bg-accent" : "border-border text-muted-foreground hover:text-foreground",
								)}
							>
								<span className="truncate">
									{l.source} — {l.title}
								</span>
								<LectureLength lecture={l} />
							</button>
						) : null,
					)}
				</div>
			)}
			{lines && <Transcript key={transcriptKey} lines={lines} time={time} onSeek={controllable ? seek : null} />}
		</section>
	);
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** "12 min · 14:30–26:10" for a clipped lecture, "9 min" for a whole one. */
function LectureLength({ lecture }: { lecture: ResolvedLecture }) {
	const clip = lecture.start !== undefined || lecture.end !== undefined;
	const minutes = lecture.minutes ?? (lecture.end !== undefined ? Math.round((lecture.end - (lecture.start ?? 0)) / 60) : undefined);
	if (minutes === undefined && !clip) return null;
	return (
		<span className="shrink-0 text-muted-foreground/80">
			{minutes !== undefined ? `${Math.round(minutes)} min` : ""}
			{clip ? `${minutes !== undefined ? " · " : ""}${clock(lecture.start ?? 0)}–${lecture.end !== undefined ? clock(lecture.end) : "end"}` : ""}
		</span>
	);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Collapsible, searchable transcript: the line playing now is highlighted
 *  and kept in view inside the panel; clicking a line seeks there. */
function Transcript({ lines, time, onSeek }: { lines: TranscriptLine[]; time: number; onSeek: ((t: number) => void) | null }) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const listRef = useRef<HTMLOListElement>(null);
	const userScrollAt = useRef(0);

	const current = useMemo(() => {
		let idx = -1;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i]!.t <= time + 0.5) idx = i;
			else break;
		}
		return idx;
	}, [lines, time]);

	const q = query.trim();
	const match = useMemo(() => (q ? new RegExp(`(${escapeRe(q)})`, "gi") : null), [q]);
	const shown = useMemo(() => {
		const all = lines.map((l, i) => ({ ...l, i }));
		return q ? all.filter((l) => l.text.toLowerCase().includes(q.toLowerCase())) : all;
	}, [lines, q]);

	// Keep the current line in view — scrolling the panel only, never the
	// page, and not while the learner is scrolling it themselves.
	useEffect(() => {
		if (!open || current < 0 || Date.now() - userScrollAt.current < 5000) return;
		const list = listRef.current;
		const el = list?.querySelector<HTMLElement>(`[data-line="${current}"]`);
		if (!list || !el) return;
		const top = el.offsetTop;
		if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
			list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: "smooth" });
		}
	}, [current, open, shown]);

	const markUser = () => {
		userScrollAt.current = Date.now();
	};

	return (
		<section className="rounded-xl border border-border bg-card" data-testid="lecture-transcript">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
			>
				<ScrollTextIcon className="size-3.5" /> Transcript
				<span className="normal-case tracking-normal text-muted-foreground/70">· {lines.length} lines</span>
				<ChevronDownIcon className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
			</button>
			{open && (
				<div className="border-t border-border">
					<label className="flex items-center gap-2 border-b border-border px-3 py-1.5">
						<SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
						<input
							type="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search the transcript"
							aria-label="Search the transcript"
							className="lh-input min-w-0 flex-1 bg-transparent py-1 text-base outline-none sm:text-sm"
						/>
						{q && (
							<span className="shrink-0 text-xs text-muted-foreground">
								{shown.length} {shown.length === 1 ? "match" : "matches"}
							</span>
						)}
					</label>
					<ol ref={listRef} onWheel={markUser} onTouchMove={markUser} className="relative max-h-72 overflow-y-auto overscroll-contain py-1">
						{shown.map((l) => (
							<li key={l.i} data-line={l.i}>
								<button
									type="button"
									disabled={!onSeek}
									onClick={() => onSeek?.(l.t)}
									aria-current={l.i === current ? "true" : undefined}
									className={cn(
										"flex w-full items-baseline gap-3 border-l-2 px-3 py-1 text-left text-sm enabled:hover:bg-accent pointer-coarse:py-2",
										l.i === current ? "border-[var(--st-available)] bg-accent text-foreground" : "border-transparent text-muted-foreground",
									)}
								>
									<span className="min-w-[7ch] shrink-0 font-mono text-xs tabular-nums text-muted-foreground">[{clock(l.t)}]</span>
									<span>
										{match
											? l.text.split(match).map((part, k) =>
													k % 2 === 1 ? (
														<mark key={k} className="rounded bg-[var(--st-available)]/30 px-0.5 text-foreground">
															{part}
														</mark>
													) : (
														part
													),
												)
											: l.text}
									</span>
								</button>
							</li>
						))}
						{shown.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No lines match “{q}”.</li>}
					</ol>
				</div>
			)}
		</section>
	);
}
