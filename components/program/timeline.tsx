"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProgressSnapshot } from "@/src/core";
import type { ProgramView } from "./use-program";
import { TRACK_COLOR, fmtDate, pct } from "./status";

/**
 * The plan-vs-reality Gantt: one row per course. The faint outlined bar is
 * the original plan (program start, target pace); the solid bar is the
 * projection from today at your recent pace, filled to the share already
 * mastered. A vertical line marks today.
 */
export function Timeline({ program, snapshot }: { program: ProgramView; snapshot: ProgressSnapshot }) {
	const [hover, setHover] = useState<string | null>(null);
	const DAY = 86_400_000;
	const weeksSoFar = Math.max(0, Math.floor((Date.parse(snapshot.now) - Date.parse(snapshot.startDate)) / (7 * DAY)));
	const horizon = Math.max(
		program.targetWeeks,
		...snapshot.plan.map((w) => w.endWeek),
		...snapshot.projection.map((w) => w.endWeek),
		weeksSoFar + 4,
	);
	const labelW = 150;
	const rowH = 22;
	const w = 900;
	const plotW = w - labelW - 12;
	const h = program.courses.length * rowH + 34;
	const x = (week: number) => labelW + (week / horizon) * plotW;
	const plan = new Map(snapshot.plan.map((p) => [p.courseId, p]));
	const proj = new Map(snapshot.projection.map((p) => [p.courseId, p]));
	const yearTicks: number[] = [];
	for (let wk = 0; wk <= horizon; wk += 26) yearTicks.push(wk);

	return (
		<div>
			<svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Program timeline">
				{yearTicks.map((wk) => (
					<g key={wk}>
						<line x1={x(wk)} x2={x(wk)} y1={0} y2={h - 18} stroke="var(--border)" strokeOpacity={0.35} />
						<text x={x(wk)} y={h - 4} fontSize={9.5} textAnchor="middle" fill="var(--muted-foreground)">
							{wk === 0 ? "start" : `${(wk / 52).toFixed(1).replace(/\.0$/, "")} y`}
						</text>
					</g>
				))}
				{program.courses.map((c, i) => {
					const y = i * rowH + 4;
					const p = plan.get(c.id);
					const pr = proj.get(c.id);
					const cp = snapshot.courses[c.id];
					const color = TRACK_COLOR[c.track] ?? "var(--foreground)";
					const done = cp?.status === "passed" || (cp?.fraction ?? 0) >= 0.999;
					const isHover = hover === c.id;
					return (
						<g key={c.id} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)}>
							<rect x={0} y={y - 2} width={w} height={rowH} fill={isHover ? "var(--accent)" : "transparent"} fillOpacity={0.5} />
							<text x={8} y={y + rowH / 2 - 1} fontSize={11} dominantBaseline="middle" fill={isHover ? "var(--foreground)" : "var(--muted-foreground)"}>
								<tspan fontWeight={600} fill={color}>
									{c.code}
								</tspan>{" "}
								{c.title.length > 17 ? `${c.title.slice(0, 16)}…` : c.title}
							</text>
							{p && (
								<rect
									x={x(p.startWeek)}
									y={y + 2}
									width={Math.max(2, x(p.endWeek) - x(p.startWeek))}
									height={rowH - 8}
									rx={4}
									fill="none"
									stroke={color}
									strokeOpacity={0.45}
									strokeDasharray="3 3"
								/>
							)}
							{pr && !done && pr.endWeek > pr.startWeek && (
								<g>
									<rect x={x(pr.startWeek)} y={y + 4} width={Math.max(2, x(pr.endWeek) - x(pr.startWeek))} height={rowH - 12} rx={3} fill={color} fillOpacity={0.35} />
									<rect
										x={x(pr.startWeek)}
										y={y + 4}
										width={Math.max(0, (x(pr.endWeek) - x(pr.startWeek)) * (cp?.fraction ?? 0))}
										height={rowH - 12}
										rx={3}
										fill={color}
									/>
								</g>
							)}
							{done && p && (
								<text x={x(Math.min(weeksSoFar, horizon)) + 6} y={y + rowH / 2 - 1} fontSize={10} dominantBaseline="middle" fill="var(--st-mastered)">
									✓ passed
								</text>
							)}
						</g>
					);
				})}
				<line x1={x(weeksSoFar)} x2={x(weeksSoFar)} y1={0} y2={h - 18} stroke="var(--xp)" strokeWidth={1.5} />
				<text x={x(weeksSoFar) + 4} y={10} fontSize={9.5} fill="var(--xp)">
					today
				</text>
			</svg>
			<div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
				<span>
					<span className="mr-1 inline-block h-2.5 w-5 rounded-sm border border-dashed border-muted-foreground align-middle" /> original plan
				</span>
				<span>
					<span className="mr-1 inline-block h-2.5 w-5 rounded-sm bg-muted-foreground/40 align-middle" /> projection at your recent pace (filled = mastered)
				</span>
				{hover && (
					<Link href={`/program/course/${hover}`} className="ml-auto text-foreground">
						{program.courses.find((c) => c.id === hover)?.title} · {pct(snapshot.courses[hover]?.fraction ?? 0)} mastered →
					</Link>
				)}
			</div>
			<div className="mt-1 text-xs text-muted-foreground">
				Target finish {fmtDate(snapshot.pace.targetFinish)} · projected {fmtDate(snapshot.pace.projectedFinish)}
			</div>
		</div>
	);
}
