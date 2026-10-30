"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import katex from "katex";
import {
	BookOpenIcon,
	CheckCircle2Icon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ClipboardCheckIcon,
	DumbbellIcon,
	ExternalLinkIcon,
	GraduationCapIcon,
	HeadphonesIcon,
	MonitorPlayIcon,
	SparklesIcon,
	TimerIcon,
} from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/src/core";
import { STATUS_COLOR, STATUS_LABEL, TRACK_COLOR, pct } from "./status";
import { postProgressEvent, useProgram, useStudyHeartbeat } from "./use-program";

/** The lesson page payload (src/server/curriculum.ts lessonDetail). */
export interface LessonPageData {
	lesson: Lesson;
	unit: { id: string; title: string; summary: string; grad: boolean };
	course: { id: string; code: string; title: string; track: string };
	readings: { bookId: string; label: string; ref: string; title: string; pages?: string; pdfPages?: [number, number]; ingested: boolean; optional: boolean }[];
	siblings: { id: string; title: string }[];
	prevId: string | null;
	nextId: string | null;
}

interface ResolvedLecture {
	source: string;
	title: string;
	url: string;
	start?: number;
	end?: number;
	youtubeId: string | null;
	playlistId: string | null;
	embedUrl: string | null;
	videoUrl?: string;
}

/**
 * One lesson, lecture-first: the lecture player leads, then the path —
 * read, learn with the tutor, try a demo, check, practice. The sidebar
 * carries the objectives, key equations, and the lesson's place in its unit.
 */
export function LessonPage({ detail }: { detail: LessonPageData }) {
	const { lesson, unit, course } = detail;
	const router = useRouter();
	const { data } = useProgram(null);
	useStudyHeartbeat(lesson.id);
	const lp = data?.snapshot.lessons[lesson.id];
	const status = lp?.status ?? "locked";
	const [starting, setStarting] = useState<"teach" | "practice" | null>(null);

	useEffect(() => {
		void postProgressEvent({ type: "lesson_started", lessonId: lesson.id });
	}, [lesson.id]);

	async function startSession(mode: "teach" | "practice") {
		setStarting(mode);
		try {
			const res = await fetch("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: `${course.code} · ${lesson.title}`,
					lessonId: lesson.id,
					...(mode === "practice" ? { kind: "practice" } : {}),
				}),
			});
			const body = (await res.json()) as { id?: string };
			if (!res.ok || !body.id) throw new Error("could not create the session");
			const opener =
				mode === "practice"
					? "Give me practice problems for this lesson."
					: "I'm ready to start this lesson.";
			router.push(`/chat/${body.id}?prompt=${encodeURIComponent(opener)}`);
		} catch {
			setStarting(null);
		}
	}

	const steps = [
		{ icon: MonitorPlayIcon, label: "Watch the lecture", done: lesson.lectures.length === 0 },
		{ icon: BookOpenIcon, label: "Read the assigned sections" },
		{ icon: GraduationCapIcon, label: "Learn it with your tutor" },
		{ icon: SparklesIcon, label: "Play with a demo" },
		{ icon: ClipboardCheckIcon, label: "Quick check (≥ 80% masters it)" },
	];

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<Link href={`/program/course/${course.id}`} className="truncate hover:text-foreground" style={{ color: TRACK_COLOR[course.track] }}>
						{course.code}
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span className="truncate">{unit.title}</span>
				</div>
				<div className="ml-auto flex items-center gap-1">
					{detail.prevId && (
						<Link href={`/program/lesson/${detail.prevId}`} className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11" aria-label="Previous lesson">
							<ChevronLeftIcon className="size-4" />
						</Link>
					)}
					{detail.nextId && (
						<Link href={`/program/lesson/${detail.nextId}`} className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11" aria-label="Next lesson">
							<ChevronRightIcon className="size-4" />
						</Link>
					)}
				</div>
			</TopBar>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto grid max-w-[1400px] gap-6 px-6 py-5 xl:grid-cols-[minmax(0,1fr)_360px]">
					<main className="min-w-0 space-y-5">
						<header>
							<div className="flex flex-wrap items-center gap-3 text-xs">
								<span className="rounded-full border px-2 py-0.5" style={{ borderColor: STATUS_COLOR[status], color: STATUS_COLOR[status] }}>
									{STATUS_LABEL[status]}
									{lp?.testedOut ? " · tested out" : ""}
								</span>
								<span className="flex items-center gap-1 text-muted-foreground">
									<TimerIcon className="size-3.5" /> {lesson.minutes} min
								</span>
								{unit.grad && <span className="text-[var(--st-review)]">graduate extension</span>}
								{lp?.bestCheck !== null && lp?.bestCheck !== undefined && <span className="text-muted-foreground">best check {pct(lp.bestCheck)}</span>}
								{lp && lp.minutesStudied > 0 && <span className="text-muted-foreground">{Math.round(lp.minutesStudied)} min studied</span>}
							</div>
							<h1 className="font-title mt-2 text-4xl leading-tight tracking-tight">{lesson.title}</h1>
						</header>

						<LecturePlayer lessonId={lesson.id} count={lesson.lectures.length} />

						<section className="grid gap-3 md:grid-cols-2">
							<ActionCard
								icon={GraduationCapIcon}
								title="Learn with your tutor"
								body="A guided session built from this lesson's objectives and your readings. It checks what you already know, then teaches one step at a time."
								action={starting === "teach" ? "Starting…" : "Start lesson session"}
								onClick={() => void startSession("teach")}
								primary
							/>
							<ActionCard
								icon={ClipboardCheckIcon}
								title="Quick check"
								body="Five questions on the objectives. Score 80% or higher to master the lesson and schedule its spaced review."
								action="Take quick check"
								href={`/program/check/${lesson.id}`}
							/>
							<ActionCard
								icon={DumbbellIcon}
								title="Practice problems"
								body="Bite-sized problems with hints that adapt to your reasoning, drawn from the textbook's exercises where possible."
								action={starting === "practice" ? "Starting…" : "Start practice"}
								onClick={() => void startSession("practice")}
							/>
							<ActionCard
								icon={HeadphonesIcon}
								title="Audio guide"
								body="A spoken walkthrough of this lesson for a walk or a commute, generated locally with Kokoro."
								action="Open audio"
								href={`/program/audio?lesson=${lesson.id}`}
							/>
						</section>

						{detail.readings.length > 0 && (
							<section className="rounded-xl border border-border bg-card p-4">
								<h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
									<BookOpenIcon className="size-3.5" /> Reading
								</h2>
								<ul className="space-y-2">
									{detail.readings.map((r, i) => (
										<li key={i} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
											<span className={cn(r.optional && "text-muted-foreground")}>
												{r.label}
												{r.optional ? " (optional)" : ""}
											</span>
											{r.ingested && r.pdfPages ? (
												<Link href={`/program/books/${r.bookId}?page=${r.pdfPages[0]}&end=${r.pdfPages[1]}`} className="text-xs text-[var(--st-available)] hover:underline pointer-coarse:py-2">
													Read pp. {r.pages} →
												</Link>
											) : (
												<Link href="/program/books" className="text-xs text-muted-foreground hover:text-foreground">
													add this book to the shelf
												</Link>
											)}
										</li>
									))}
								</ul>
							</section>
						)}

						{lesson.demoIdeas.length > 0 && (
							<section className="rounded-xl border border-border bg-card p-4">
								<h2 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
									<SparklesIcon className="size-3.5" /> Interactive demos (supplement)
								</h2>
								<LessonDemos lessonId={lesson.id} ideas={lesson.demoIdeas} />
							</section>
						)}
					</main>

					<aside className="space-y-4">
						<div className="rounded-xl border border-border bg-card p-4">
							<h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Your path</h2>
							<ol className="space-y-2 text-sm">
								{steps.map((s, i) => (
									<li key={i} className="flex items-center gap-2">
										<s.icon className="size-4 text-muted-foreground" />
										<span>{s.label}</span>
									</li>
								))}
							</ol>
							<div className="mt-4 flex gap-2">
								<button
									type="button"
									onClick={() => void postProgressEvent({ type: "lesson_completed", lessonId: lesson.id })}
									className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent pointer-coarse:min-h-11"
								>
									<CheckCircle2Icon className="size-3.5" /> {lp?.completed ? "Session done ✓" : "Mark session done"}
								</button>
								<LogTime lessonId={lesson.id} />
							</div>
						</div>

						<div className="rounded-xl border border-border bg-card p-4">
							<h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Objectives</h2>
							<ul className="lh-prose list-disc space-y-1.5 pl-4 text-[15px]">
								{lesson.objectives.map((o, i) => (
									<li key={i}>
										<MathText text={o} />
									</li>
								))}
							</ul>
						</div>

						{lesson.keyEquations.length > 0 && (
							<div className="rounded-xl border border-border bg-card p-4">
								<h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Key equations</h2>
								<div className="space-y-3 overflow-x-auto">
									{lesson.keyEquations.map((eq, i) => (
										<Equation key={i} tex={eq} />
									))}
								</div>
							</div>
						)}

						{lesson.practice.length > 0 && (
							<div className="rounded-xl border border-border bg-card p-4">
								<h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Textbook exercises</h2>
								<ul className="space-y-1 text-sm">
									{lesson.practice.map((p, i) => (
										<li key={i}>{p}</li>
									))}
								</ul>
							</div>
						)}

						<div className="rounded-xl border border-border bg-card p-4">
							<h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{unit.title}</h2>
							<p className="mb-2 text-xs text-muted-foreground">{unit.summary}</p>
							<ol className="space-y-0.5 text-sm">
								{detail.siblings.map((s) => {
									const st = data?.snapshot.lessons[s.id]?.status ?? "locked";
									return (
										<li key={s.id}>
											<Link
												href={`/program/lesson/${s.id}`}
												className={cn("flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent pointer-coarse:py-2.5", s.id === lesson.id && "bg-accent")}
											>
												<span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[st] }} />
												<span className="truncate">{s.title}</span>
											</Link>
										</li>
									);
								})}
							</ol>
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}

function LecturePlayer({ lessonId, count }: { lessonId: string; count: number }) {
	const [lectures, setLectures] = useState<ResolvedLecture[] | null>(null);
	const [active, setActive] = useState(0);
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

	if (count === 0)
		return (
			<div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
				No curated lecture for this lesson yet. Your tutor session and the readings carry it.
			</div>
		);
	if (!lectures) return <div className="aspect-video animate-pulse rounded-xl bg-card" />;
	const lec = lectures[active];
	if (!lec) return null;
	const src = lec.embedUrl;
	return (
		<section className="space-y-2">
			{lec.videoUrl ? (
				<video key={lec.videoUrl} src={lec.videoUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl border border-border bg-black" />
			) : src ? (
				<div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
					<iframe
						key={src}
						src={src}
						title={lec.title}
						className="size-full"
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
			<div className="flex flex-wrap gap-2">
				{lectures.map((l, i) => (
					<button
						key={i}
						type="button"
						onClick={() => setActive(i)}
						className={cn(
							"flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left text-xs pointer-coarse:min-h-11",
							i === active ? "border-foreground bg-accent" : "border-border text-muted-foreground hover:text-foreground",
						)}
					>
						<MonitorPlayIcon className="size-3 shrink-0" />
						<span className="truncate">
							{l.source} — {l.title}
						</span>
					</button>
				))}
				<a href={lec.url} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-11">
					source page <ExternalLinkIcon className="size-3" />
				</a>
			</div>
		</section>
	);
}

function ActionCard({
	icon: Icon,
	title,
	body,
	action,
	href,
	onClick,
	primary,
}: {
	icon: typeof MonitorPlayIcon;
	title: string;
	body: string;
	action: string;
	href?: string;
	onClick?: () => void;
	primary?: boolean;
}) {
	const btn = cn(
		"mt-3 inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium pointer-coarse:min-h-11",
		primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border hover:bg-accent",
	);
	return (
		<div className="flex flex-col rounded-xl border border-border bg-card p-4">
			<div className="flex items-center gap-2 font-semibold">
				<Icon className="size-4" /> {title}
			</div>
			<p className="mt-1 flex-1 text-sm text-muted-foreground">{body}</p>
			{href ? (
				<Link href={href} className={btn}>
					{action}
				</Link>
			) : (
				<button type="button" onClick={onClick} className={btn}>
					{action}
				</button>
			)}
		</div>
	);
}

function LogTime({ lessonId }: { lessonId: string }) {
	const [open, setOpen] = useState(false);
	const [min, setMin] = useState("30");
	return open ? (
		<form
			className="flex flex-1 items-center gap-1"
			onSubmit={(e) => {
				e.preventDefault();
				const m = Number(min);
				if (m > 0) void postProgressEvent({ type: "study_time", minutes: Math.min(240, m), lessonId, source: "manual" });
				setOpen(false);
			}}
		>
			<input value={min} onChange={(e) => setMin(e.target.value)} type="number" min={1} max={240} className="lh-input w-14 rounded-md border border-border bg-background px-1.5 py-1 text-xs pointer-coarse:min-h-11" />
			<button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent pointer-coarse:min-h-11">
				log min
			</button>
		</form>
	) : (
		<button type="button" onClick={() => setOpen(true)} className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent pointer-coarse:min-h-11">
			Log reading time
		</button>
	);
}

function Equation({ tex }: { tex: string }) {
	const html = useMemo(() => {
		try {
			return katex.renderToString(tex, { displayMode: true, throwOnError: false });
		} catch {
			return null;
		}
	}, [tex]);
	return html ? <div className="text-[15px]" dangerouslySetInnerHTML={{ __html: html }} /> : <code className="text-xs">{tex}</code>;
}

/** Objectives may carry inline $…$ math. */
function MathText({ text }: { text: string }) {
	const parts = useMemo(() => text.split(/(\$[^$]+\$)/g), [text]);
	return (
		<>
			{parts.map((p, i) =>
				p.startsWith("$") && p.endsWith("$") && p.length > 2 ? (
					<span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(p.slice(1, -1), { throwOnError: false }) }} />
				) : (
					<span key={i}>{p}</span>
				),
			)}
		</>
	);
}

/** Cached lesson demos (built once by the demo builder, reused forever). */
function LessonDemos({ lessonId, ideas }: { lessonId: string; ideas: string[] }) {
	return (
		<ul className="space-y-2 text-sm">
			{ideas.map((idea, i) => (
				<li key={i} className="flex items-start justify-between gap-3">
					<span className="text-muted-foreground">{idea}</span>
					<Link href={`/program/demo/${lessonId}/${i}`} className="shrink-0 text-xs text-[var(--st-available)] hover:underline pointer-coarse:py-2">
						Open demo →
					</Link>
				</li>
			))}
		</ul>
	);
}
