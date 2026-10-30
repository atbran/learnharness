"use client";

import { useMemo, useState } from "react";
import type { ProgressSnapshot } from "@/src/core";
import { pct } from "./status";

/** "Hover …" on a mouse, "Tap …" on touch (iPad companion): the readouts
 *  below the charts work by hover OR tap, so the hint names the gesture the
 *  device actually has. */
export function GestureHint({ rest }: { rest: string }) {
	return (
		<>
			<span className="pointer-coarse:hidden">Hover {rest}</span>
			<span className="hidden pointer-coarse:inline">Tap {rest}</span>
		</>
	);
}

/** Mouse hover previews a readout; a tap/click PINS it (tap again to
 *  unpin). Touch pointers skip the hover path so a tap doesn't flicker
 *  through enter/leave. Returns the item to show. */
export function useHoverOrPick<T>(same: (a: T, b: T) => boolean) {
	const [hover, setHover] = useState<T | null>(null);
	const [picked, setPicked] = useState<T | null>(null);
	const bind = (item: T) => ({
		onPointerEnter: (e: React.PointerEvent) => {
			if (e.pointerType === "mouse") setHover(item);
		},
		onPointerLeave: (e: React.PointerEvent) => {
			if (e.pointerType === "mouse") setHover(null);
		},
		onClick: () => setPicked((p) => (p !== null && same(p, item) ? null : item)),
	});
	return { shown: hover ?? picked, bind };
}

/** A progress ring: `value` 0..1, colored arc over a faint track. */
export function ProgressRing({
	value,
	size = 56,
	stroke = 6,
	color = "var(--st-mastered)",
	children,
}: {
	value: number;
	size?: number;
	stroke?: number;
	color?: string;
	children?: React.ReactNode;
}) {
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	const v = Math.max(0, Math.min(1, value));
	return (
		<div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
			<svg width={size} height={size} className="-rotate-90">
				<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} />
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					stroke={color}
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={`${c * v} ${c}`}
					style={{ transition: "stroke-dasharray 600ms ease" }}
				/>
			</svg>
			<div className="absolute inset-0 flex items-center justify-center text-[11px] font-medium">{children}</div>
		</div>
	);
}

/** Subject mastery radar (one axis per subject). */
export function MasteryRadar({ subjects }: { subjects: ProgressSnapshot["subjects"] }) {
	const { shown: hover, bind } = useHoverOrPick<number>((a, b) => a === b);
	const size = 360;
	const cx = size / 2;
	const cy = size / 2;
	const R = 130;
	const n = subjects.length;
	if (n < 3) return <div className="text-sm text-muted-foreground">Not enough subjects yet.</div>;
	const pt = (i: number, v: number) => {
		const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
		return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v] as const;
	};
	const poly = subjects.map((s, i) => pt(i, Math.max(0.02, s.mastery)).join(",")).join(" ");
	// Room for labels on every side: names wrap onto two lines at a word
	// boundary, and the hover readout lives below the chart, not in a label.
	const padX = 110;
	const padY = 34;
	const lines = (name: string): string[] => {
		if (name.length <= 12) return [name];
		const words = name.split(" ");
		let best = 1;
		for (let k = 1; k < words.length; k++)
			if (Math.abs(words.slice(0, k).join(" ").length - name.length / 2) < Math.abs(words.slice(0, best).join(" ").length - name.length / 2)) best = k;
		return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
	};
	const active = hover !== null ? subjects[hover] : undefined;
	return (
		<div className="w-full max-w-[560px]">
		<svg viewBox={`${-padX} ${-padY} ${size + 2 * padX} ${size + 2 * padY}`} className="h-auto w-full" role="img" aria-label="Mastery by subject">
			{[0.25, 0.5, 0.75, 1].map((ring) => (
				<polygon
					key={ring}
					points={subjects.map((_, i) => pt(i, ring).join(",")).join(" ")}
					fill="none"
					stroke="var(--border)"
					strokeOpacity={ring === 1 ? 0.9 : 0.4}
				/>
			))}
			{subjects.map((_, i) => {
				const [x, y] = pt(i, 1);
				return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeOpacity={0.4} />;
			})}
			<polygon points={poly} fill="var(--st-mastered)" fillOpacity={0.22} stroke="var(--st-mastered)" strokeWidth={2} style={{ transition: "all 600ms ease" }} />
			{subjects.map((s, i) => {
				const [x, y] = pt(i, Math.max(0.02, s.mastery));
				const [lx, ly] = pt(i, 1.12);
				const label = lines(s.subject);
				return (
					<g key={s.subject} {...bind(i)} className="cursor-pointer">
						{/* Invisible finger-sized hit area around the data point. */}
						<circle cx={x} cy={y} r={14} fill="transparent" />
						<circle cx={x} cy={y} r={hover === i ? 5 : 3.5} fill="var(--st-mastered)" />
						<text
							x={lx}
							y={ly - ((label.length - 1) * 12) / 2}
							textAnchor={Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end"}
							dominantBaseline="middle"
							fontSize={11}
							fill={hover === i ? "var(--foreground)" : "var(--muted-foreground)"}
						>
							{label.map((line, li) => (
								<tspan key={li} x={lx} dy={li === 0 ? 0 : 12}>
									{line}
								</tspan>
							))}
						</text>
					</g>
				);
			})}
		</svg>
		<div className="h-5 text-center text-xs text-muted-foreground">
			{active ? `${active.subject}: ${pct(active.mastery)} mastered · ${Math.round(active.hours)} h of lessons` : <GestureHint rest="a subject for detail" />}
		</div>
		</div>
	);
}

/** GitHub-style calendar of study minutes over the last ~26 weeks. */
export function StudyHeatmap({ byDate, now, weeks = 26 }: { byDate: Record<string, number>; now: string; weeks?: number }) {
	const { shown: hover, bind } = useHoverOrPick<{ d: string; m: number }>((a, b) => a.d === b.d);
	const cells = useMemo(() => {
		const end = new Date(`${now.slice(0, 10)}T00:00:00Z`);
		const dow = (end.getUTCDay() + 6) % 7;
		const start = new Date(end.getTime() - (weeks * 7 - 1 - (6 - dow)) * 86_400_000);
		const out: { d: string; m: number; x: number; y: number; future: boolean }[] = [];
		for (let i = 0; i < weeks * 7; i++) {
			const date = new Date(start.getTime() + i * 86_400_000);
			const d = date.toISOString().slice(0, 10);
			out.push({ d, m: byDate[d] ?? 0, x: Math.floor(i / 7), y: i % 7, future: date > end });
		}
		return out;
	}, [byDate, now, weeks]);
	const level = (m: number) => (m <= 0 ? 0 : m < 20 ? 0.3 : m < 45 ? 0.55 : m < 90 ? 0.8 : 1);
	const cell = 13;
	return (
		<div>
			<svg viewBox={`0 0 ${weeks * cell + 2} ${7 * cell + 2}`} className="h-auto w-full" role="img" aria-label="Study calendar">
				{cells.map((c) => (
					<rect
						key={c.d}
						x={c.x * cell + 1}
						y={c.y * cell + 1}
						width={cell - 3}
						height={cell - 3}
						rx={2.5}
						fill={c.m > 0 ? "var(--st-mastered)" : "var(--accent)"}
						fillOpacity={c.future ? 0.15 : c.m > 0 ? level(c.m) : 0.7}
						stroke={hover?.d === c.d ? "var(--foreground)" : undefined}
						strokeWidth={hover?.d === c.d ? 1 : undefined}
						{...bind({ d: c.d, m: c.m })}
					/>
				))}
			</svg>
			<div className="mt-1 h-4 text-xs text-muted-foreground">
				{hover ? `${hover.d}: ${Math.round(hover.m)} min` : <GestureHint rest="a day · darker = longer study" />}
			</div>
		</div>
	);
}

/** Score trend for problem sets and exams (chronological). */
export function ScoreTrends({ assessments }: { assessments: ProgressSnapshot["assessments"] }) {
	const { shown, bind } = useHoverOrPick<number>((a, b) => a === b);
	const items = [...assessments].sort((a, b) => a.at.localeCompare(b.at));
	if (items.length === 0)
		return <div className="text-sm text-muted-foreground">Scores appear here after your first problem set or exam.</div>;
	const w = 520;
	const h = 160;
	const pad = 24;
	const x = (i: number) => pad + (items.length === 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (items.length - 1));
	const y = (s: number) => h - pad - s * (h - 2 * pad);
	const color = (k: string) => (k === "pset" ? "var(--st-available)" : k === "placement" ? "var(--st-review)" : "var(--xp)");
	const describe = (a: (typeof items)[number]) => `${a.kind} · ${a.courseId} · ${pct(a.score)} · ${a.at.slice(0, 10)}`;
	const active = shown !== null ? items[shown] : undefined;
	return (
		<div>
		<svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Score trend">
			{[0, 0.5, 0.7, 1].map((g) => (
				<g key={g}>
					<line x1={pad} x2={w - pad} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeOpacity={g === 0.7 ? 0.9 : 0.3} strokeDasharray={g === 0.7 ? "4 4" : undefined} />
					<text x={4} y={y(g)} fontSize={9} fill="var(--muted-foreground)" dominantBaseline="middle">
						{Math.round(g * 100)}
					</text>
				</g>
			))}
			<polyline points={items.map((a, i) => `${x(i)},${y(a.score)}`).join(" ")} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.5} />
			{items.map((a, i) => (
				<g key={a.assessmentId + a.at} {...bind(i)} className="cursor-pointer">
					<circle cx={x(i)} cy={y(a.score)} r={12} fill="transparent" />
					<circle cx={x(i)} cy={y(a.score)} r={shown === i ? 6 : 4.5} fill={color(a.kind)}>
						<title>{describe(a)}</title>
					</circle>
				</g>
			))}
		</svg>
		<div className="mt-1 h-4 text-xs text-muted-foreground">{active ? describe(active) : <GestureHint rest="a point for detail" />}</div>
		</div>
	);
}
