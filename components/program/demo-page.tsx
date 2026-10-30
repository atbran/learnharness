"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, FilmIcon, FlaskConicalIcon, Loader2Icon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { DemoOutputCard } from "@/components/artifacts/demo-card";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { TRACK_COLOR } from "./status";
import { useStudyHeartbeat } from "./use-program";

type BuildState = { status: "idle" | "building" | "error"; error?: string; activity?: string; startedAt?: string };
type Kind = "demo" | "explainer";

/** The demo page payload (src/server/demos.ts demoView). */
export interface DemoPageData {
	lessonId: string;
	index: number;
	idea: string;
	title: string;
	lesson: { title: string };
	course: { id: string; code: string; track: string };
	ideas: { text: string; built: boolean }[];
	demo: { title: string; html: string; tested: true; notes?: string; createdAt: string } | null;
	build: BuildState;
	explainer: {
		available: boolean;
		reason?: string;
		video: { url: string; seconds: number; notes?: string; createdAt: string } | null;
		build: BuildState;
	};
}

/** One lesson demo: built once by the demo builder (and tested headlessly),
 *  then served from the cache, with an optional Manim explainer animation
 *  above it. Builds run in the background. */
export function DemoPage({ initial }: { initial: DemoPageData }) {
	const [view, setView] = useState(initial);
	const [posting, setPosting] = useState<Kind | null>(null);
	const [error, setError] = useState<{ kind: Kind; message: string } | null>(null);
	const { lessonId, index, demo, build, explainer } = view;
	const building = build.status === "building";
	const anyBuilding = building || explainer.build.status === "building";
	useStudyHeartbeat(lessonId);

	const load = useCallback(() => {
		void fetch(`/api/program/demos/${lessonId}/${index}`)
			.then((r) => r.json())
			.then((v: DemoPageData) => setView(v))
			.catch(() => {});
	}, [lessonId, index]);
	useServerEvent("curriculum-changed", () => {
		if (anyBuilding) load();
	});
	// The builders' activity lines aren't events: poll them while building.
	useEffect(() => {
		if (!anyBuilding) return;
		const t = setInterval(load, 3000);
		return () => clearInterval(t);
	}, [anyBuilding, load]);

	async function start(kind: Kind, fresh: boolean) {
		setPosting(kind);
		setError(null);
		try {
			const res = await fetch(`/api/program/demos/${lessonId}/${index}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fresh, kind }),
			});
			const body = (await res.json()) as DemoPageData & { error?: string };
			if (!res.ok) throw new Error(body.error ?? "could not start the build");
			setView(body);
		} catch (err) {
			setError({ kind, message: err instanceof Error ? err.message : String(err) });
		} finally {
			setPosting(null);
		}
	}

	const prev = index > 0 ? index - 1 : null;
	const next = index < view.ideas.length - 1 ? index + 1 : null;
	const demoError = error?.kind === "demo" ? error.message : null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0" />
					<Link href={`/program/course/${view.course.id}`} className="hover:text-foreground" style={{ color: TRACK_COLOR[view.course.track] }}>
						{view.course.code}
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0" />
					<Link href={`/program/lesson/${lessonId}`} className="truncate hover:text-foreground">
						{view.lesson.title}
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0" />
					<span className="shrink-0">Demo {index + 1}</span>
				</div>
				<div className="ml-auto flex items-center gap-1">
					{prev !== null && (
						<Link href={`/program/demo/${lessonId}/${prev}`} className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11" aria-label="Previous demo">
							<ChevronLeftIcon className="size-4" />
						</Link>
					)}
					{next !== null && (
						<Link href={`/program/demo/${lessonId}/${next}`} className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11" aria-label="Next demo">
							<ChevronRightIcon className="size-4" />
						</Link>
					)}
				</div>
			</TopBar>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[1400px] space-y-5 px-6 py-5 max-sm:px-4">
					<header className="flex flex-wrap items-end justify-between gap-4">
						<div className="min-w-0 max-w-3xl">
							<div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
								<SparklesIcon className="size-3.5" /> Interactive demo {index + 1} of {view.ideas.length}
							</div>
							<h1 className="font-title mt-2 text-3xl leading-tight tracking-tight">{view.title}</h1>
							<p className="mt-2 text-[15px] text-muted-foreground">{view.idea}</p>
						</div>
						{demo && (
							<div className="flex flex-col items-end gap-1">
								<button
									type="button"
									disabled={building || posting !== null}
									onClick={() => void start("demo", true)}
									title="Build a new version; this one stays until the new one passes its test"
									className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 pointer-coarse:min-h-11"
								>
									<RefreshCwIcon className={cn("size-3.5", building && "animate-spin")} /> {building ? "Rebuilding…" : "Rebuild"}
								</button>
								{/* Touch has no title tooltip: the caption carries it. */}
								<span className="hidden max-w-60 text-right text-[11px] text-muted-foreground pointer-coarse:block">Builds a new version; this one stays until it passes its test</span>
							</div>
						)}
					</header>

					<Explainer view={view} posting={posting === "explainer"} error={error?.kind === "explainer" ? error.message : null} onStart={(fresh) => void start("explainer", fresh)} />

					{(building || build.status === "error" || demoError) && <BuildStatus what="demo" build={build} error={demoError} hasResult={!!demo} />}

					{demo ? (
						<section className="space-y-2">
							<DemoOutputCard output={demo} />
							<p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
								<span suppressHydrationWarning>Tested in a headless browser · built {new Date(demo.createdAt).toLocaleDateString()}</span>
								{demo.notes && <span className="text-sm text-foreground/80">{demo.notes}</span>}
							</p>
						</section>
					) : (
						!building && (
							<div className="rounded-xl border border-border bg-card p-6 text-center">
								<FlaskConicalIcon className="mx-auto size-6 text-muted-foreground" />
								<p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
									Not built yet. The demo builder writes it from this lesson's objectives and key equations, tests it in a headless browser, and fixes it until it runs clean.
									It takes a few minutes once; after that it opens instantly.
								</p>
								<button
									type="button"
									disabled={posting !== null}
									onClick={() => void start("demo", false)}
									className="mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-11"
								>
									{build.status === "error" ? "Try again" : "Build demo"}
								</button>
							</div>
						)
					)}

					{view.ideas.length > 1 && (
						<section className="rounded-xl border border-border bg-card p-4">
							<h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Other demos for this lesson</h2>
							<ol className="space-y-0.5 text-sm">
								{view.ideas.map((d, k) => (
									<li key={k}>
										<Link
											href={`/program/demo/${lessonId}/${k}`}
											className={cn("flex items-start gap-2 rounded-md px-2 py-1 hover:bg-accent pointer-coarse:py-2.5", k === index && "bg-accent")}
										>
											<span
												className="mt-1.5 size-2 shrink-0 rounded-full"
												style={{ background: d.built ? "var(--st-mastered)" : "var(--st-locked)" }}
												title={d.built ? "built" : "not built yet"}
											/>
											<span className={cn(k !== index && "text-muted-foreground")}>
												{d.text}
												{/* The dot's title is hover-only; touch gets the words. */}
												<span className="hidden text-xs text-muted-foreground/70 pointer-coarse:inline"> · {d.built ? "built" : "not built yet"}</span>
											</span>
										</Link>
									</li>
								))}
							</ol>
						</section>
					)}

					<Link href={`/program/lesson/${lessonId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">
						<ChevronLeftIcon className="size-4" /> Back to the lesson
					</Link>
				</div>
			</div>
		</div>
	);
}

/** The optional Manim explainer: a rendered video, a build button, or a
 *  hint when Manim isn't installed on this machine. */
function Explainer({ view, posting, error, onStart }: { view: DemoPageData; posting: boolean; error: string | null; onStart: (fresh: boolean) => void }) {
	const { available, reason, video, build } = view.explainer;
	const building = build.status === "building";
	const kicker = (
		<h2 className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
			<FilmIcon className="size-3.5" /> Explainer animation
		</h2>
	);
	if (!video && !available)
		return (
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 py-3">
				{kicker}
				<span className="text-xs text-muted-foreground">{reason}</span>
			</div>
		);
	return (
		<section className="space-y-2 rounded-xl border border-border bg-card p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				{kicker}
				{available && (video || !building) && (
					<div className="flex flex-col items-end gap-1">
					<button
						type="button"
						disabled={building || posting}
						onClick={() => onStart(!!video)}
						title={video ? "Render a new version; this one stays until the new one renders" : undefined}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 pointer-coarse:min-h-11",
							video ? "border border-border hover:bg-accent" : "bg-primary font-medium text-primary-foreground hover:opacity-90",
						)}
					>
						{video ? (
							<>
								<RefreshCwIcon className={cn("size-3.5", building && "animate-spin")} /> {building ? "Re-rendering…" : "Re-render"}
							</>
						) : build.status === "error" ? (
							"Try again"
						) : (
							"Animate this idea"
						)}
					</button>
					{/* Touch has no title tooltip: the caption carries it. */}
					{video && <span className="hidden max-w-60 text-right text-[11px] text-muted-foreground pointer-coarse:block">Renders a new version; this one stays until it renders</span>}
					</div>
				)}
			</div>
			{(building || build.status === "error" || error) && <BuildStatus what="animation" build={build} error={error} hasResult={!!video} />}
			{video ? (
				<>
					<video key={video.url} src={video.url} controls playsInline preload="metadata" className="max-h-[70vh] w-full rounded-lg border border-border bg-black" />
					<p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
						<span suppressHydrationWarning>
							Manim · {Math.round(video.seconds)} s · rendered {new Date(video.createdAt).toLocaleDateString()}
						</span>
						{video.notes && <span className="text-sm text-foreground/80">{video.notes}</span>}
					</p>
				</>
			) : (
				!building &&
				build.status !== "error" && (
					<p className="text-sm text-muted-foreground">
						A short 3Blue1Brown-style animation of this idea, written as a Manim scene and rendered on this machine (fixed and re-rendered until it runs). It takes a few minutes once.
					</p>
				)
			)}
		</section>
	);
}

function BuildStatus({ what, build, error, hasResult }: { what: "demo" | "animation"; build: BuildState; error: string | null; hasResult: boolean }) {
	// The clock starts after mount: a server-rendered Date.now() would not
	// match the client's and break hydration.
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		if (build.status !== "building") return;
		const tick = () => setNow(Date.now());
		const first = setTimeout(tick, 0);
		const t = setInterval(tick, 1000);
		return () => {
			clearTimeout(first);
			clearInterval(t);
		};
	}, [build.status]);

	if (build.status === "building") {
		const secs = build.startedAt && now ? Math.max(0, Math.round((now - Date.parse(build.startedAt)) / 1000)) : 0;
		return (
			<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
				<Loader2Icon className="size-5 shrink-0 animate-spin text-muted-foreground" />
				<div className="min-w-0">
					<div>
						{what === "demo" ? "Building + testing…" : "Writing + rendering…"}{" "}
						<span className="text-muted-foreground tabular-nums">
							{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
						</span>
					</div>
					<div className="truncate text-xs text-muted-foreground">
						{build.activity ?? "starting"}
						{hasResult ? ` · the current ${what} stays until the new one is ready` : " · usually a few minutes"}
					</div>
				</div>
			</div>
		);
	}
	return (
		<div className="rounded-xl border border-destructive/40 bg-card p-4 text-sm">
			<div className="font-medium text-destructive">{error ? "Could not start the build" : `The last ${what} build failed`}</div>
			<p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{error ?? build.error}</p>
			{!error && hasResult && <p className="mt-1 text-xs text-muted-foreground">Showing the previous working version.</p>}
		</div>
	);
}
