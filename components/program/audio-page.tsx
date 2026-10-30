"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
	MediaControlBar,
	MediaController,
	MediaDurationDisplay,
	MediaPlayButton,
	MediaPlaybackRateButton,
	MediaSeekBackwardButton,
	MediaSeekForwardButton,
	MediaTimeDisplay,
	MediaTimeRange,
} from "media-chrome/react";
import { ChevronRightIcon, DownloadIcon, HeadphonesIcon, Loader2Icon, MessageSquareTextIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { TRACK_COLOR } from "./status";
import { useProgram } from "./use-program";

/** src/server/audio.ts AudioGuideState (mirrored: components import only the core barrel). */
interface GuideState {
	id: string;
	kind: "lesson" | "session";
	title: string;
	subtitle: string;
	audio: { bytes: number; updatedAt: string } | null;
	job: { phase: "script" | "synth"; done?: number; total?: number } | null;
	error?: string;
	words?: number;
}
interface GuideList {
	ttsReady: boolean;
	guides: GuideState[];
	sessions: { id: string; title: string; updatedAt: string; lessonId?: string }[];
}

const isSession = (id: string) => id.startsWith("chat_");
const focusHref = (id: string) => `/program/audio?${isSession(id) ? "session" : "lesson"}=${encodeURIComponent(id)}`;
const fileUrl = (g: GuideState) => `/api/program/audio/file/${encodeURIComponent(g.id)}?v=${encodeURIComponent(g.audio?.updatedAt ?? "")}`;

async function generate(body: Record<string, unknown>): Promise<string | null> {
	const res = await fetch("/api/program/audio/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	if (res.ok) return null;
	const b = (await res.json().catch(() => ({}))) as { error?: string };
	return b.error ?? res.statusText;
}

function startGuide(id: string, opts: { rewrite?: boolean; resynth?: boolean } = {}) {
	return generate(isSession(id) ? { chatId: id, resynth: opts.resynth } : { lessonId: id, ...opts });
}

function useGuides(): { list: GuideList | null; refresh: () => void } {
	const [list, setList] = useState<GuideList | null>(null);
	const refresh = useCallback(() => {
		fetch("/api/program/audio")
			.then((r) => r.json())
			.then((b: GuideList) => setList(b))
			.catch(() => {});
	}, []);
	useEffect(refresh, [refresh]);
	useServerEvent("curriculum-changed", refresh);
	useServerResync(refresh);
	return { list, refresh };
}

function fmtMinutes(words?: number): string | null {
	return words ? `~${Math.max(1, Math.round(words / 180))} min` : null;
}

function JobLabel({ job }: { job: NonNullable<GuideState["job"]> }) {
	const pct = job.total ? Math.round((100 * (job.done ?? 0)) / job.total) : null;
	return (
		<span className="flex items-center gap-1.5 text-xs text-[var(--st-progress)]">
			<Loader2Icon className="size-3.5 animate-spin" />
			{job.phase === "script" ? "Writing the script…" : `Synthesizing${pct !== null ? ` ${pct}%` : "…"}`}
		</span>
	);
}

/**
 * Audio guides: a spoken walkthrough per lesson (Kokoro, local), plus
 * read-aloud versions of finished teaching sessions. `focus` (?lesson= or
 * ?session=) opens one guide on top with the player and its script.
 */
export function AudioPage({ focus }: { focus: string | null }) {
	const { data } = useProgram(null);
	const { list, refresh } = useGuides();
	const [error, setError] = useState<string | null>(null);
	const byId = useMemo(() => new Map((list?.guides ?? []).map((g) => [g.id, g])), [list]);
	const lessonTitle = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of data?.program.courses ?? []) for (const u of c.units) for (const l of u.lessons) m.set(l.id, l.title);
		return m;
	}, [data]);
	const focusCourse = useMemo(
		() => (focus && !isSession(focus) ? data?.program.courses.find((c) => c.units.some((u) => u.lessons.some((l) => l.id === focus)))?.id : undefined),
		[data, focus],
	);

	async function start(id: string, opts?: { rewrite?: boolean; resynth?: boolean }) {
		setError(await startGuide(id, opts));
		refresh();
	}

	const ready = (list?.guides ?? []).filter((g) => g.audio || g.job || g.error);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span>Audio guides</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
					{list && !list.ttsReady && (
						<div className="flex gap-3 rounded-xl border border-[var(--st-progress)] bg-card p-4 text-sm">
							<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-[var(--st-progress)]" />
							<div>
								Local text-to-speech isn&apos;t set up. Run <code className="rounded bg-muted px-1.5 py-0.5 text-xs">powershell -ExecutionPolicy Bypass -File scripts/setup-tts.ps1</code> once (Python 3.11, ~350 MB of model files).
							</div>
						</div>
					)}
					{error && <div className="rounded-xl border border-destructive/50 bg-card p-3 text-sm text-destructive">{error}</div>}

					{focus && <FocusGuide key={focus} id={focus} fallbackTitle={lessonTitle.get(focus)} onStart={start} ttsReady={!!list?.ttsReady} />}

					{ready.length > 0 && (
						<section className="rounded-xl border border-border bg-card p-4">
							<h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
								<HeadphonesIcon className="size-3.5" /> Your guides
							</h2>
							<ul className="divide-y divide-border">
								{ready.map((g) => (
									<li key={g.id} className="flex items-center gap-3 py-2">
										<Link href={focusHref(g.id)} className={cn("min-w-0 flex-1 hover:text-foreground", g.id === focus && "text-[var(--st-available)]")}>
											<div className="truncate text-sm">{g.title}</div>
											<div className="truncate text-xs text-muted-foreground">
												{g.subtitle}
												{fmtMinutes(g.words) ? ` · ${fmtMinutes(g.words)}` : ""}
											</div>
										</Link>
										{g.job ? (
											<JobLabel job={g.job} />
										) : g.error && !g.audio ? (
											<span className="text-xs text-destructive">failed</span>
										) : (
											<a href={`${fileUrl(g)}&download=1&name=${encodeURIComponent(g.title)}`} className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11" aria-label="Download">
												<DownloadIcon className="size-4" />
											</a>
										)}
									</li>
								))}
							</ul>
						</section>
					)}

					{(list?.sessions.length ?? 0) > 0 && (
						<section className="rounded-xl border border-border bg-card p-4">
							<h2 className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
								<MessageSquareTextIcon className="size-3.5" /> Teaching sessions
							</h2>
							<p className="mb-3 text-xs text-muted-foreground">Listen back to what your tutor explained in a session.</p>
							<ul className="divide-y divide-border">
								{list!.sessions.map((s) => {
									const g = byId.get(s.id);
									return (
										<li key={s.id} className="flex items-center gap-3 py-2">
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm">{s.title}</div>
												<div className="truncate text-xs text-muted-foreground">
													{new Date(s.updatedAt).toLocaleDateString()}
													{s.lessonId && lessonTitle.get(s.lessonId) ? ` · ${lessonTitle.get(s.lessonId)}` : ""}
												</div>
											</div>
											<GuideAction id={s.id} guide={g} onStart={start} disabled={!list?.ttsReady} label="Read aloud" />
										</li>
									);
								})}
							</ul>
						</section>
					)}

					<section className="space-y-2">
						<h2 className="text-xs uppercase tracking-wider text-muted-foreground">All lessons</h2>
						{(data?.program.courses ?? []).map((c) => (
							<details key={c.id} open={c.id === focusCourse} className="group rounded-xl border border-border bg-card">
								<summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm pointer-coarse:min-h-12">
									<ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
									<span style={{ color: TRACK_COLOR[c.track] }}>{c.code}</span>
									<span className="truncate">{c.title}</span>
									<span className="ml-auto text-xs text-muted-foreground">
										{c.units.reduce((n, u) => n + u.lessons.filter((l) => byId.get(l.id)?.audio).length, 0)}/{c.units.reduce((n, u) => n + u.lessons.length, 0)}
									</span>
								</summary>
								<div className="space-y-3 border-t border-border px-4 py-3">
									{c.units.map((u) => (
										<div key={u.id}>
											<div className="mb-1 text-xs text-muted-foreground">{u.title}</div>
											<ul>
												{u.lessons.map((l) => (
													<li key={l.id} className={cn("flex items-center gap-3 rounded-md px-2 py-1", l.id === focus && "bg-accent")}>
														<Link href={focusHref(l.id)} className="min-w-0 flex-1 truncate text-sm hover:text-foreground pointer-coarse:py-3">
															{l.title}
														</Link>
														<GuideAction id={l.id} guide={byId.get(l.id)} onStart={start} disabled={!list?.ttsReady} label="Generate" />
													</li>
												))}
											</ul>
										</div>
									))}
								</div>
							</details>
						))}
					</section>
				</div>
			</div>
		</div>
	);
}

function GuideAction({ id, guide, onStart, disabled, label }: { id: string; guide?: GuideState; onStart: (id: string) => void; disabled: boolean; label: string }) {
	if (guide?.job) return <JobLabel job={guide.job} />;
	if (guide?.audio)
		return (
			<Link href={focusHref(id)} className="text-xs text-[var(--st-mastered)] hover:underline">
				Listen →
			</Link>
		);
	return (
		<span className="flex shrink-0 flex-col items-end gap-0.5">
			<button
				type="button"
				disabled={disabled}
				onClick={() => onStart(id)}
				className={cn("rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-3.5", guide?.error && "border-destructive/50 text-destructive")}
				title={guide?.error}
			>
				{guide?.error ? "Retry" : label}
			</button>
			{/* Touch has no title tooltip: the failure reason shows as a caption. */}
			{guide?.error && <span className="hidden max-w-56 text-right text-[11px] leading-snug text-destructive/80 line-clamp-2 pointer-coarse:block">{guide.error}</span>}
		</span>
	);
}

/** The focused guide: player, download, regenerate, and the script. */
function FocusGuide({ id, fallbackTitle, onStart, ttsReady }: { id: string; fallbackTitle?: string; onStart: (id: string, opts?: { rewrite?: boolean; resynth?: boolean }) => void; ttsReady: boolean }) {
	const [guide, setGuide] = useState<(GuideState & { script: string | null }) | null>(null);
	const [missing, setMissing] = useState(false);
	const refresh = useCallback(() => {
		fetch(`/api/program/audio/status?id=${encodeURIComponent(id)}`)
			.then(async (r) => {
				if (r.status === 404) return setMissing(true);
				setGuide((await r.json()) as GuideState & { script: string | null });
			})
			.catch(() => {});
	}, [id]);
	useEffect(refresh, [refresh]);
	useServerEvent("curriculum-changed", refresh);
	useServerResync(refresh);

	if (missing)
		return <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No lesson or session called “{id}”.</div>;
	const title = guide?.title ?? fallbackTitle ?? "…";

	return (
		<section className="rounded-xl border border-[var(--st-available)]/40 bg-card p-5">
			<div className="text-xs uppercase tracking-wider text-muted-foreground">{guide?.subtitle ?? (isSession(id) ? "Teaching session" : "Lesson")}</div>
			<div className="mt-1 flex flex-wrap items-baseline gap-3">
				<h1 className="font-title text-3xl leading-tight tracking-tight">{title}</h1>
				{!isSession(id) && (
					<Link href={`/program/lesson/${id}`} className="text-xs text-muted-foreground hover:text-foreground">
						open lesson →
					</Link>
				)}
			</div>

			<div className="mt-4">
				{guide?.audio ? (
					<Player key={guide.audio.updatedAt} guide={guide} />
				) : guide?.job ? (
					<div className="rounded-lg border border-border p-4">
						<JobLabel job={guide.job} />
						{guide.job.total ? (
							<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
								<div className="h-full bg-[var(--st-progress)] transition-[width]" style={{ width: `${(100 * (guide.job.done ?? 0)) / guide.job.total}%` }} />
							</div>
						) : (
							<p className="mt-1 text-xs text-muted-foreground">The script writer is drafting a 12–15 minute walkthrough; synthesis follows on this machine.</p>
						)}
					</div>
				) : guide ? (
					<div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4">
						<p className="flex-1 text-sm text-muted-foreground">
							{isSession(id) ? "Turn this session's explanations into audio." : "No audio guide yet. One is written for this lesson, then spoken locally with Kokoro."}
						</p>
						<button
							type="button"
							disabled={!ttsReady}
							onClick={() => onStart(id)}
							className="rounded-lg bg-[var(--st-available)] px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-40 pointer-coarse:min-h-11"
						>
							Generate audio guide
						</button>
					</div>
				) : null}
				{guide?.error && <p className="mt-2 text-xs text-destructive">Last attempt failed: {guide.error}</p>}
			</div>

			{guide?.audio && !guide.job && (
				<div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
					<a
						href={`${fileUrl(guide)}&download=1&name=${encodeURIComponent(guide.title)}`}
						className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 hover:bg-accent pointer-coarse:min-h-11"
					>
						<DownloadIcon className="size-3.5" /> Download for phone ({(guide.audio.bytes / 1e6).toFixed(1)} MB)
					</a>
					<button type="button" disabled={!ttsReady} onClick={() => onStart(id, { resynth: true })} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 hover:bg-accent disabled:opacity-40 pointer-coarse:min-h-11">
						<RefreshCwIcon className="size-3.5" /> Re-synthesize
					</button>
					{!isSession(id) && (
						<button type="button" disabled={!ttsReady} onClick={() => onStart(id, { rewrite: true })} className="rounded-lg px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 pointer-coarse:min-h-11">
							Rewrite script
						</button>
					)}
				</div>
			)}

			{guide?.script && (
				<details className="group mt-4 rounded-lg border border-border">
					<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground pointer-coarse:min-h-11">
						<ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" /> Script
						{fmtMinutes(guide.words) ? <span className="normal-case tracking-normal">· {guide.words} words, {fmtMinutes(guide.words)}</span> : null}
					</summary>
					<div className="lh-prose max-h-[60vh] space-y-3 overflow-y-auto border-t border-border px-4 py-3 text-[15px]">
						{guide.script.split(/\n\s*\n/).map((p, i) => (
							<p key={i}>{p}</p>
						))}
					</div>
				</details>
			)}
		</section>
	);
}

/** media-chrome player: play, ±15 s, scrubbable timeline, time, speed. */
function Player({ guide }: { guide: GuideState }) {
	return (
		<MediaController
			audio
			className="w-full overflow-hidden rounded-lg border border-border"
			style={
				{
					"--media-background-color": "var(--card)",
					"--media-control-background": "var(--muted)",
					"--media-control-hover-background": "var(--accent)",
					"--media-primary-color": "var(--foreground)",
					"--media-secondary-color": "var(--muted)",
					"--media-range-bar-color": "var(--st-available)",
					"--media-range-track-background": "var(--border)",
					"--media-font-family": "inherit",
					width: "100%",
				} as CSSProperties
			}
		>
			<audio slot="media" src={fileUrl(guide)} preload="metadata" />
			<MediaControlBar className="w-full">
				<MediaPlayButton />
				<MediaSeekBackwardButton seekOffset={15} />
				<MediaSeekForwardButton seekOffset={15} />
				<MediaTimeDisplay />
				<MediaTimeRange className="flex-1" />
				<MediaDurationDisplay />
				<MediaPlaybackRateButton rates={[0.8, 1, 1.15, 1.3, 1.5, 1.75, 2]} />
			</MediaControlBar>
		</MediaController>
	);
}
