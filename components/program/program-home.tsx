"use client";

import { useState } from "react";
import Link from "next/link";
import { AwardIcon, CalendarClockIcon, FlameIcon, LibraryIcon, MapIcon, RadarIcon, RepeatIcon, Settings2Icon, TrophyIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { MasteryRadar, ProgressRing, ScoreTrends, StudyHeatmap } from "./charts";
import { ProgramMap } from "./program-map";
import { Timeline } from "./timeline";
import { STATUS_COLOR, STATUS_LABEL, TRACK_COLOR, fmtDate, pct } from "./status";
import { useProgram, useStudyHeartbeat, type ProgramData } from "./use-program";

type Tab = "map" | "timeline" | "mastery" | "badges";

const TABS: { id: Tab; label: string; icon: typeof MapIcon }[] = [
	{ id: "map", label: "Map", icon: MapIcon },
	{ id: "timeline", label: "Timeline", icon: CalendarClockIcon },
	{ id: "mastery", label: "Mastery", icon: RadarIcon },
	{ id: "badges", label: "Badges", icon: AwardIcon },
];

export function ProgramHome({ initial }: { initial: ProgramData | null }) {
	const { data, error } = useProgram(initial);
	const [tab, setTab] = useState<Tab>("map");
	useStudyHeartbeat();
	if (!data) return <div className="p-8 text-sm text-muted-foreground">{error ?? "Loading program…"}</div>;
	const { program, snapshot: s } = data;
	const lessonMeta = new Map(
		program.courses.flatMap((c) => c.units.flatMap((u) => u.lessons.map((l) => [l.id, { lesson: l, course: c, unit: u }] as const))),
	);
	const masteredCount = Object.values(s.lessons).filter((l) => l.masteredAt).length;
	const totalLessons = Object.keys(s.lessons).length;
	const weekShare = s.study.thisWeekMinutes / Math.max(1, s.study.weekTargetMinutes);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<h1 className="font-title text-3xl tracking-tight">Physics Program</h1>
				<div className="ml-auto flex items-center gap-2">
					<Link href="/program/books" className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11">
						<LibraryIcon className="size-3.5" /> Bookshelf
					</Link>
					<ProgramSettings hoursPerWeek={s.pace.hoursPerWeekTarget} startDate={s.startDate} parallel={s.parallel} />
				</div>
			</TopBar>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[1400px] space-y-5 px-6 py-5">
					{/* Stat strip */}
					<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
						<Stat label="Program">
							<ProgressRing value={s.pace.doneHours / Math.max(1, s.pace.plannedHours)} size={52}>
								{pct(s.pace.doneHours / Math.max(1, s.pace.plannedHours))}
							</ProgressRing>
							<div className="text-xs text-muted-foreground">
								{masteredCount}/{totalLessons} lessons
								<br />
								{Math.round(s.pace.doneHours)}/{s.pace.plannedHours} h
							</div>
						</Stat>
						<Stat label="This week">
							<ProgressRing value={weekShare} size={52} color="var(--st-available)">
								{(s.study.thisWeekMinutes / 60).toFixed(1)}h
							</ProgressRing>
							<div className="text-xs text-muted-foreground">
								goal {s.pace.hoursPerWeekTarget} h
								<br />
								recent {s.pace.recentHoursPerWeek.toFixed(1)} h/wk
							</div>
						</Stat>
						<Stat label="Streak">
							<FlameIcon className="size-9" style={{ color: s.streak.current > 0 ? "var(--streak)" : "var(--st-locked)" }} />
							<div>
								<div className="text-2xl font-semibold leading-none">{s.streak.current}</div>
								<div className="mt-1 text-xs text-muted-foreground">days · best {s.streak.best}</div>
							</div>
						</Stat>
						<Stat label={`Level ${s.level.level}`}>
							<div className="w-full">
								<div className="flex items-baseline justify-between">
									<span className="text-2xl font-semibold" style={{ color: "var(--xp)" }}>
										{s.xp.toLocaleString()}
									</span>
									<span className="text-xs text-muted-foreground">XP</span>
								</div>
								<div className="mt-2 h-2 overflow-hidden rounded-full bg-accent">
									<div className="h-full rounded-full transition-all" style={{ width: pct(s.level.xpIntoLevel / s.level.xpForLevel), background: "var(--xp)" }} />
								</div>
								<div className="mt-1 text-[11px] text-muted-foreground">
									{s.level.xpForLevel - s.level.xpIntoLevel} XP to level {s.level.level + 1}
								</div>
							</div>
						</Stat>
						<Stat label="Finish">
							<CalendarClockIcon className="size-8 text-muted-foreground" />
							<div>
								<div className="text-lg font-semibold leading-tight">{fmtDate(s.pace.projectedFinish)}</div>
								<div className={cn("text-xs", s.pace.slipWeeks > 2 ? "text-[var(--st-progress)]" : "text-muted-foreground")}>
									target {fmtDate(s.pace.targetFinish)}
									{s.pace.slipWeeks > 2 ? ` · ${s.pace.slipWeeks} wk behind` : s.pace.slipWeeks < -2 ? ` · ${-s.pace.slipWeeks} wk ahead` : " · on track"}
								</div>
							</div>
						</Stat>
						<Stat label="Reviews">
							<RepeatIcon className="size-8" style={{ color: s.reviewsDue.length ? "var(--st-review)" : "var(--st-locked)" }} />
							<div>
								<div className="text-2xl font-semibold leading-none">{s.reviewsDue.length}</div>
								{s.reviewsDue.length > 0 ? (
									<Link href="/program/review" className="mt-1 block text-xs text-[var(--st-review)] hover:underline pointer-coarse:py-2">
										start review →
									</Link>
								) : (
									<div className="mt-1 text-xs text-muted-foreground">due today</div>
								)}
							</div>
						</Stat>
					</div>

					{/* Up next */}
					<section>
						<h2 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Up next</h2>
						<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{[...s.reviewsDue.slice(0, 2), ...s.next].slice(0, 6).map((id) => {
								const meta = lessonMeta.get(id);
								const lp = s.lessons[id];
								if (!meta || !lp) return null;
								return (
									<Link
										key={id}
										href={`/program/lesson/${id}`}
										className={cn("group rounded-xl border bg-card p-4 transition-colors hover:bg-accent", lp.status === "available" && "lh-glow")}
										style={{ borderColor: STATUS_COLOR[lp.status], ["--glow" as string]: STATUS_COLOR[lp.status] }}
									>
										<div className="flex items-center gap-2 text-[11px] uppercase tracking-wider">
											<span style={{ color: TRACK_COLOR[meta.course.track] }}>{meta.course.code}</span>
											<span className="text-muted-foreground">· {meta.unit.title}</span>
										</div>
										<div className="mt-1.5 text-[15px] font-semibold leading-snug">{meta.lesson.title}</div>
										<div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
											<span style={{ color: STATUS_COLOR[lp.status] }}>{STATUS_LABEL[lp.status]}</span>
											<span>{meta.lesson.minutes} min</span>
											{meta.lesson.lectures > 0 && <span>▶ lecture</span>}
										</div>
									</Link>
								);
							})}
							{s.next.length === 0 && s.reviewsDue.length === 0 && (
								<div className="text-sm text-muted-foreground">Nothing ready yet. Open the map to pick a lesson.</div>
							)}
						</div>
					</section>

					{/* Views */}
					<section>
						<div className="mb-3 flex gap-1 border-b border-border">
							{TABS.map((t) => (
								<button
									key={t.id}
									type="button"
									onClick={() => setTab(t.id)}
									className={cn(
										"-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors pointer-coarse:min-h-11",
										tab === t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
									)}
								>
									<t.icon className="size-4" /> {t.label}
								</button>
							))}
						</div>
						{tab === "map" && <ProgramMap program={program} snapshot={s} />}
						{tab === "timeline" && (
							<div className="rounded-xl border border-border bg-card p-4">
								<Timeline program={program} snapshot={s} />
							</div>
						)}
						{tab === "mastery" && (
							<div className="grid gap-4 lg:grid-cols-2">
								<Panel title="Mastery by subject">
									<div className="flex justify-center">
										<MasteryRadar subjects={s.subjects} />
									</div>
								</Panel>
								<div className="space-y-4">
									<Panel title="Study calendar">
										<StudyHeatmap byDate={s.study.byDate} now={s.now} />
										<div className="mt-1 text-xs text-muted-foreground">{(s.study.totalMinutes / 60).toFixed(1)} h studied in total</div>
									</Panel>
									<Panel title="Problem set & exam scores">
										<ScoreTrends assessments={s.assessments} />
									</Panel>
								</div>
								<Panel title="Courses" className="lg:col-span-2">
									<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
										{program.courses.map((c) => {
											const cp = s.courses[c.id];
											return (
												<Link key={c.id} href={`/program/course/${c.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-accent">
													<ProgressRing value={cp?.fraction ?? 0} size={40} stroke={4} color={TRACK_COLOR[c.track]}>
														<span className="text-[10px]">{pct(cp?.fraction ?? 0)}</span>
													</ProgressRing>
													<div className="min-w-0">
														<div className="truncate text-sm">
															<span style={{ color: TRACK_COLOR[c.track] }}>{c.code}</span> {c.title}
														</div>
														<div className="text-xs text-muted-foreground">
															{cp?.status}
															{cp?.final !== null && cp?.final !== undefined ? ` · final ${pct(cp.final)}` : ""}
															{cp?.psetAverage !== null && cp?.psetAverage !== undefined ? ` · psets ${pct(cp.psetAverage)}` : ""}
														</div>
													</div>
												</Link>
											);
										})}
									</div>
								</Panel>
							</div>
						)}
						{tab === "badges" && (
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
								{s.badges.map((b) => (
									<div
										key={b.id}
										className={cn("rounded-xl border p-4 text-center transition-opacity", b.earnedAt ? "border-[var(--xp)] bg-card" : "border-border opacity-45")}
									>
										<TrophyIcon className="mx-auto size-8" style={{ color: b.earnedAt ? "var(--xp)" : "var(--st-locked)" }} />
										<div className="mt-2 text-sm font-semibold">{b.title}</div>
										<div className="mt-1 text-xs text-muted-foreground">{b.description}</div>
										{b.earnedAt && <div className="mt-1 text-[11px]" style={{ color: "var(--xp)" }}>{b.earnedAt.slice(0, 10)}</div>}
									</div>
								))}
							</div>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-border bg-card p-3">
			<div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
			<div className="flex items-center gap-3">{children}</div>
		</div>
	);
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("rounded-xl border border-border bg-card p-4", className)}>
			<h3 className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">{title}</h3>
			{children}
		</div>
	);
}

function ProgramSettings({ hoursPerWeek, startDate, parallel }: { hoursPerWeek: number; startDate: string; parallel: number }) {
	const [open, setOpen] = useState(false);
	const [courses, setCourses] = useState(String(parallel));
	const [hours, setHours] = useState(String(hoursPerWeek));
	const [start, setStart] = useState(startDate);
	return (
		<div className="relative">
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11" aria-label="Program settings">
				<Settings2Icon className="size-4" />
			</button>
			{open && (
				<div className="absolute right-0 top-full z-50 mt-1 w-64 space-y-3 rounded-xl border border-border bg-popover p-4 text-sm shadow-xl">
					<label className="block">
						<span className="text-xs text-muted-foreground">Study hours per week</span>
						<input type="number" min={1} max={80} value={hours} onChange={(e) => setHours(e.target.value)} className="lh-input mt-1 w-full rounded-md border border-border bg-background px-2 py-1 pointer-coarse:min-h-11" />
					</label>
					<label className="block">
						<span className="text-xs text-muted-foreground">Courses at once (e.g. math + physics + one more)</span>
						<input type="number" min={1} max={6} value={courses} onChange={(e) => setCourses(e.target.value)} className="lh-input mt-1 w-full rounded-md border border-border bg-background px-2 py-1 pointer-coarse:min-h-11" />
					</label>
					<label className="block">
						<span className="text-xs text-muted-foreground">Program start date</span>
						<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="lh-input mt-1 w-full rounded-md border border-border bg-background px-2 py-1 pointer-coarse:min-h-11" />
					</label>
					<button
						type="button"
						className="w-full rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground pointer-coarse:min-h-11"
						onClick={async () => {
							await fetch("/api/program/settings", {
								method: "PUT",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ hoursPerWeek: Number(hours), startDate: start, parallelCourses: Number(courses) }),
							});
							setOpen(false);
						}}
					>
						Save
					</button>
				</div>
			)}
		</div>
	);
}
