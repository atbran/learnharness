"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheckIcon, CoffeeIcon, GraduationCapIcon, HistoryIcon, RepeatIcon, ShuffleIcon, SigmaIcon, TargetIcon, ZapIcon } from "lucide-react";
import { type BreakItem, isoDate, planBreak, type PlanLesson } from "@/src/core";
import { cn } from "@/lib/utils";
import { TRACK_COLOR } from "./status";
import type { CourseView, ProgramData } from "./use-program";

const BREAKS = [15, 30, 45] as const;
const PREF_BREAK = "lh-break-minutes";

/** Start a unit's mixed-drill practice session and open it. */
export async function startUnitDrill(push: (href: string) => void, course: Pick<CourseView, "code">, unit: { id: string; title: string }): Promise<void> {
	const res = await fetch("/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: `${course.code} · Mixed drill · ${unit.title}`, unitId: unit.id, kind: "practice" }),
	});
	const body = (await res.json()) as { id?: string };
	if (!res.ok || !body.id) throw new Error("could not create the session");
	push(`/chat/${body.id}?prompt=${encodeURIComponent("Give me a mixed drill for this unit.")}`);
}

/** "3 weeks ago" from an ISO time to `today` (yyyy-mm-dd). */
function weeksAgo(at: string, today: string): string {
	const weeks = Math.max(1, Math.floor((Date.parse(today) - Date.parse(isoDate(at))) / (7 * 86_400_000)));
	return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
}

/** "Today": a plan that fits the break you have (15/30/45 min, remembered
 *  on this device) — missed questions, due reviews, the next lesson
 *  (fast-track when it qualifies), then a quiz or drill in what's left —
 *  plus this week's goal, a "then and now" question when one is due, and
 *  the equation sheets of the units you're on. */
export function TodayCard({ data }: { data: ProgramData }) {
	const router = useRouter();
	const [minutes, setMinutes] = useState<number>(30);
	const [starting, setStarting] = useState(false);
	useEffect(() => {
		try {
			const saved = Number(window.localStorage.getItem(PREF_BREAK));
			if ((BREAKS as readonly number[]).includes(saved)) setMinutes(saved);
		} catch {
			/* storage unavailable: 30 min */
		}
	}, []);
	const pick = (m: number) => {
		setMinutes(m);
		try {
			window.localStorage.setItem(PREF_BREAK, String(m));
		} catch {
			/* storage unavailable: this visit only */
		}
	};

	const { program, snapshot: s, settings, motivation } = data;
	const weekGoal = settings.weekGoals[s.weekly.thisWeek.weekStart];
	const thenNow = motivation.thenNow;
	const meta = useMemo(() => {
		const lessons: PlanLesson[] = [];
		const byLesson = new Map<string, { course: CourseView; title: string }>();
		const byUnit = new Map<string, { course: CourseView; title: string }>();
		for (const course of program.courses)
			for (const unit of course.units) {
				byUnit.set(unit.id, { course, title: unit.title });
				for (const l of unit.lessons) {
					lessons.push({ id: l.id, title: l.title, minutes: l.minutes, courseId: course.id, unitId: unit.id });
					byLesson.set(l.id, { course, title: l.title });
				}
			}
		return { lessons, byLesson, byUnit };
	}, [program]);
	const plan = planBreak(minutes, meta.lessons, s, settings.reviewMode);
	const total = plan.reduce((t, i) => t + i.minutes, 0);
	// Equation sheets: the unit of each lesson in the plan, plus the units you're on.
	const sheetUnits = [
		...new Set([
			...plan.flatMap((i) => (i.kind === "lesson" || i.kind === "quiz" ? [meta.lessons.find((l) => l.id === i.lessonId)!.unitId] : i.kind === "drill" ? [i.unitId] : [])),
			...s.next.slice(0, 3).map((id) => meta.lessons.find((l) => l.id === id)?.unitId ?? ""),
		]),
	]
		.filter((u) => meta.byUnit.has(u))
		.slice(0, 3);

	const row = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent pointer-coarse:min-h-11";
	const lessonLabel = (id: string) => {
		const m = meta.byLesson.get(id);
		return m ? (
			<>
				<span style={{ color: TRACK_COLOR[m.course.track] }}>{m.course.code}</span> · {m.title}
			</>
		) : (
			id
		);
	};
	const render = (item: BreakItem, k: number) => {
		const mins = <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{item.minutes} min</span>;
		switch (item.kind) {
			case "missed":
				return (
					<Link key={k} href="/program/review" className={row}>
						<RepeatIcon className="size-4 shrink-0 text-[var(--st-review)]" />
						<span className="min-w-0">
							Retry {item.questions} missed question{item.questions === 1 ? "" : "s"}
						</span>
						{mins}
					</Link>
				);
			case "review":
				return (
					<Link key={k} href="/program/review" className={row}>
						<RepeatIcon className="size-4 shrink-0 text-[var(--st-review)]" />
						<span className="min-w-0">
							Review {item.lessons.length} mastered lesson{item.lessons.length === 1 ? "" : "s"}
						</span>
						{mins}
					</Link>
				);
			case "lesson":
				return (
					<Link key={k} href={`/program/lesson/${item.lessonId}`} className={row}>
						{item.fastTrack ? <ZapIcon className="size-4 shrink-0 text-[var(--st-progress)]" /> : <GraduationCapIcon className="size-4 shrink-0 text-[var(--st-available)]" />}
						<span className="min-w-0 truncate">
							{item.partial ? "Start " : ""}
							{lessonLabel(item.lessonId)}
							<span className="text-muted-foreground">
								{item.fastTrack ? " · fast track" : ""}
								{item.partial ? " · finish next break" : ""}
							</span>
						</span>
						{mins}
					</Link>
				);
			case "quiz":
				return (
					<Link key={k} href={`/program/check/${item.lessonId}`} className={row}>
						<ClipboardCheckIcon className="size-4 shrink-0 text-[var(--st-mastered)]" />
						<span className="min-w-0 truncate">Quiz · {lessonLabel(item.lessonId)}</span>
						{mins}
					</Link>
				);
			case "drill": {
				const u = meta.byUnit.get(item.unitId);
				return (
					<button
						key={k}
						type="button"
						disabled={starting || !u}
						onClick={() => {
							if (!u) return;
							setStarting(true);
							startUnitDrill(router.push, u.course, { id: item.unitId, title: u.title }).catch(() => setStarting(false));
						}}
						className={cn(row, "w-full text-left disabled:opacity-50")}
					>
						<ShuffleIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 truncate">{starting ? "Starting…" : `Mixed drill · ${u?.course.code ?? ""} ${u?.title ?? ""}`}</span>
						{mins}
					</button>
				);
			}
		}
	};

	return (
		<section className="rounded-xl border border-border bg-card p-4" data-testid="today-card">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
					<CoffeeIcon className="size-3.5" /> Today&apos;s break
				</h2>
				<div className="ml-auto flex gap-1" role="radiogroup" aria-label="Break length">
					{BREAKS.map((m) => (
						<button
							key={m}
							type="button"
							role="radio"
							aria-checked={minutes === m}
							onClick={() => pick(m)}
							className={cn(
								"rounded-full border px-3 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-4",
								minutes === m ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground",
							)}
						>
							{m} min
						</button>
					))}
				</div>
			</div>
			{weekGoal && (
				<p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
					<TargetIcon className="size-3.5 shrink-0" />
					<span className="min-w-0">
						This week&apos;s goal: <span className="text-foreground">{weekGoal}</span>
					</span>
				</p>
			)}
			{plan.length === 0 ? (
				<p className="mt-3 text-sm text-muted-foreground">Nothing to plan yet. Pick a lesson on the map to get started.</p>
			) : (
				<div className="mt-2 -mx-1">
					{plan.map(render)}
					<div className="flex items-center px-3 pt-1 text-xs text-muted-foreground">
						<span className="ml-auto tabular-nums">
							{total} of {minutes} min
						</span>
					</div>
				</div>
			)}
			{thenNow && (
				<Link href={`/program/check/${thenNow.lessonId}?q=${thenNow.question}&thenNow=1`} className={cn(row, "-mx-1 mt-1")} data-testid="then-now">
					<HistoryIcon className="size-4 shrink-0 text-[var(--xp)]" />
					<span className="min-w-0">
						<span className="font-medium">Then and now</span> · {thenNow.lessonTitle}
						<span className="text-muted-foreground"> — a question you missed {weeksAgo(thenNow.missedAt, isoDate(s.now))}. Try it now.</span>
					</span>
				</Link>
			)}
			{sheetUnits.length > 0 && (
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
					<SigmaIcon className="size-3.5" /> Equation sheets:
					{sheetUnits.map((u) => {
						const m = meta.byUnit.get(u)!;
						return (
							<Link key={u} href={`/program/unit/${u}/equations`} className="hover:text-foreground pointer-coarse:py-2">
								<span style={{ color: TRACK_COLOR[m.course.track] }}>{m.course.code}</span> {m.title}
							</Link>
						);
					})}
				</div>
			)}
		</section>
	);
}
