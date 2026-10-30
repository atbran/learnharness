"use client";

import Link from "next/link";
import { ChevronRightIcon, ClipboardListIcon, FileCheck2Icon, MonitorPlayIcon, SparklesIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./charts";
import { STATUS_COLOR, STATUS_LABEL, TRACK_COLOR, pct } from "./status";
import { useProgram, type ProgramData } from "./use-program";

/** One course: header with mastery, units as lanes of lesson tiles, the
 *  unit problem sets and the course exams. */
export function CoursePage({ courseId, initial }: { courseId: string; initial: ProgramData | null }) {
	const { data } = useProgram(initial);
	if (!data) return null;
	const course = data.program.courses.find((c) => c.id === courseId);
	if (!course) return <div className="p-8 text-sm text-muted-foreground">Unknown course.</div>;
	const s = data.snapshot;
	const cp = s.courses[course.id];
	const color = TRACK_COLOR[course.track];
	const prereqs = data.program.courses.filter((c) => course.prereqs.includes(c.id));
	const coreqs = data.program.courses.filter((c) => course.coreqs.includes(c.id) || c.coreqs.includes(course.id));

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span style={{ color }}>{course.code}</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[1200px] space-y-6 px-6 py-5">
					<header className="flex flex-wrap items-center gap-5">
						<ProgressRing value={cp?.fraction ?? 0} size={88} stroke={8} color={color}>
							<span className="text-base">{pct(cp?.fraction ?? 0)}</span>
						</ProgressRing>
						<div className="min-w-0 flex-1">
							<div className="text-xs uppercase tracking-wider" style={{ color }}>
								{course.code} · {course.depth} · {course.hours} h
							</div>
							<h1 className="font-title text-4xl leading-tight tracking-tight">{course.title}</h1>
							<p className="mt-1 max-w-3xl text-sm text-muted-foreground">{course.summary}</p>
							{coreqs.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
									Take alongside:
									{coreqs.map((p) => (
										<Link key={p.id} href={`/program/course/${p.id}`} className="hover:text-foreground" style={{ color: TRACK_COLOR[p.track] }}>
											{p.code} {p.title}
										</Link>
									))}
								</div>
							)}
							{prereqs.length > 0 && (
								<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
									Builds on:
									{prereqs.map((p) => (
										<Link key={p.id} href={`/program/course/${p.id}`} className="hover:text-foreground" style={{ color: TRACK_COLOR[p.track] }}>
											{p.code} {p.title}
										</Link>
									))}
								</div>
							)}
						</div>
						<div className="grid grid-cols-3 gap-3 text-center text-xs text-muted-foreground">
							<Metric label="lessons" value={`${cp?.lessonsMastered ?? 0}/${cp?.lessonsTotal ?? 0}`} />
							<Metric label="psets" value={cp?.psetAverage != null ? pct(cp.psetAverage) : "—"} />
							<Metric label="final" value={cp?.final != null ? pct(cp.final) : "—"} />
						</div>
					</header>

					{course.exams.length > 0 && (
						<section className="flex flex-wrap gap-3">
							{course.exams.map((e) => (
								<Link
									key={e.id}
									href={`/program/assessment/new?exam=${e.id}`}
									className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm hover:bg-accent"
								>
									<FileCheck2Icon className="size-4" style={{ color: e.kind === "placement" ? "var(--st-review)" : "var(--xp)" }} />
									<span>
										<span className="font-medium">{e.title}</span>
										<span className="block text-xs text-muted-foreground">
											{e.minutes} min · pass {pct(e.passMark)}
											{e.kind === "placement" ? " · test out of lessons you know" : ""}
										</span>
									</span>
								</Link>
							))}
						</section>
					)}

					<div className="space-y-5">
						{course.units.map((u, ui) => {
							const up = s.units[u.id];
							return (
								<section key={u.id} className="rounded-xl border border-border bg-card p-4">
									<div className="mb-3 flex flex-wrap items-center gap-3">
										<span className="text-xs text-muted-foreground">Unit {ui + 1}</span>
										<h2 className="text-lg font-semibold">{u.title}</h2>
										{u.grad && <span className="rounded-full border border-[var(--st-review)] px-2 text-[11px] text-[var(--st-review)]">grad</span>}
										<div className="ml-auto flex items-center gap-3">
											<div className="h-1.5 w-32 overflow-hidden rounded bg-accent">
												<div className="h-full bg-[var(--st-mastered)]" style={{ width: pct((up?.mastered ?? 0) / Math.max(1, up?.total ?? 1)) }} />
											</div>
											<Link
												href={`/program/assessment/new?unit=${u.id}`}
												className={cn(
													"flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs hover:bg-accent",
													up?.passed ? "border-[var(--st-mastered)] text-[var(--st-mastered)]" : "border-border",
												)}
											>
												<ClipboardListIcon className="size-3.5" /> Problem set{up?.psetBest != null ? ` · ${pct(up.psetBest)}` : ""}
											</Link>
										</div>
									</div>
									<p className="mb-3 text-sm text-muted-foreground">{u.summary}</p>
									<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
										{u.lessons.map((l) => {
											const st = s.lessons[l.id]?.status ?? "locked";
											return (
												<Link
													key={l.id}
													href={`/program/lesson/${l.id}`}
													className={cn("group flex items-start gap-2.5 rounded-lg border bg-background p-3 transition-colors hover:bg-accent", st === "available" && "lh-glow")}
													style={{ borderColor: st === "locked" ? "var(--border)" : STATUS_COLOR[st], ["--glow" as string]: STATUS_COLOR[st] }}
												>
													<span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[st] }} />
													<span className="min-w-0 flex-1">
														<span className="block text-sm leading-snug">{l.title}</span>
														<span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
															{STATUS_LABEL[st]} · {l.minutes} min
															{l.lectures > 0 && <MonitorPlayIcon className="size-3" />}
															{l.demos > 0 && <SparklesIcon className="size-3" />}
														</span>
													</span>
												</Link>
											);
										})}
									</div>
								</section>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-border px-3 py-2">
			<div className="text-lg font-semibold text-foreground">{value}</div>
			{label}
		</div>
	);
}
