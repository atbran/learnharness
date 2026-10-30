"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheckIcon, CheckIcon, XIcon } from "lucide-react";
import { addDays, isoDate, type UnitPace, weekStart, type WeekSummary } from "@/src/core";
import { cn } from "@/lib/utils";
import { TRACK_COLOR, fmtDay } from "./status";
import type { CourseView, ProgramData } from "./use-program";

const DISMISS_KEY = (week: string) => `lh-weekly-review-dismissed:${week}`;

export interface ReviewPlan {
	/** Which week the card sums up. */
	summarize: "this" | "last";
	/** The Monday the goal box writes to. */
	goalWeek: string;
}

/** When the weekly review shows and what it covers. Sunday: this week,
 *  which is ending, with a goal for tomorrow's week. Monday: last week,
 *  with a goal for the week just begun. Other days: only when opened, then
 *  this week so far and a goal for next week. `today` is yyyy-mm-dd. */
export function reviewPlan(today: string, opened: boolean): ReviewPlan | null {
	const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
	const monday = weekStart(today);
	if (dow === 1) return { summarize: "last", goalWeek: monday };
	if (dow === 0 || opened) return { summarize: "this", goalWeek: addDays(monday, 7) };
	return null;
}

export interface PaceRow {
	course: CourseView;
	unit: { id: string; title: string };
	pace: UnitPace;
}

export const PACE_LABEL = { upcoming: "starts soon", ahead: "ahead", "on-track": "on track", behind: "behind", done: "done" } as const;
export const PACE_COLOR = {
	upcoming: "var(--st-locked)",
	ahead: "var(--st-mastered)",
	"on-track": "var(--st-available)",
	behind: "var(--st-progress)",
	done: "var(--st-mastered)",
} as const;

/** Three dots for the weekly lesson target, filled as lessons finish. */
export function WeekDots({ finished, target, className }: { finished: number; target: number; className?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
			{Array.from({ length: target }, (_, i) => (
				<span key={i} className="size-2 rounded-full" style={{ background: i < finished ? "var(--streak)" : "var(--accent)", outline: i < finished ? undefined : "1px solid var(--border)" }} />
			))}
		</span>
	);
}

function encouragement(w: WeekSummary): string {
	if (w.finished === 0) return "A quiet week happens. One lesson is all it takes to start the next one.";
	if (w.bestSince === "ever") return "Your best week yet.";
	// "Best since" only means something with at least one weaker week in between.
	if (w.bestSince && w.bestSince < addDays(w.weekStart, -7)) return `Best week since the week of ${fmtDay(w.bestSince)}.`;
	if (w.met) return "Target met — a steady week.";
	return `${w.finished} lesson${w.finished === 1 ? "" : "s"} finished — every one is yours to keep.`;
}

/** The weekly review card: Sundays and Mondays on its own (dismissible per
 *  week), any day when opened from the Streak stat. */
export function WeeklyReview({
	data,
	paceRows,
	opened,
	onClose,
	onChanged,
}: {
	data: ProgramData;
	paceRows: PaceRow[];
	/** Opened from the "This week" link (shows any day, ignores dismissal). */
	opened: boolean;
	onClose: () => void;
	onChanged: () => void;
}) {
	const { snapshot: s, motivation, settings } = data;
	const today = isoDate(s.now);
	const plan = reviewPlan(today, opened);
	const week = plan ? (plan.summarize === "this" ? motivation.thisWeek : motivation.lastWeek) : null;
	// Dismissal lives on this device; until it's read, stay hidden (no flash).
	const [dismissed, setDismissed] = useState<boolean | null>(null);
	useEffect(() => {
		if (!week) return;
		let d = false;
		try {
			d = window.localStorage.getItem(DISMISS_KEY(week.weekStart)) === "1";
		} catch {
			/* storage unavailable: show it */
		}
		setDismissed(d);
	}, [week]);

	const savedGoal = plan ? (settings.weekGoals[plan.goalWeek] ?? "") : "";
	const [goal, setGoal] = useState(savedGoal);
	const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
	useEffect(() => setGoal(savedGoal), [savedGoal]);

	if (!plan || !week) return null;
	if (!opened && dismissed !== false) return null;

	const close = () => {
		// Closing a mid-week peek must not hide Sunday's or Monday's own review.
		if (reviewPlan(today, false)) {
			try {
				window.localStorage.setItem(DISMISS_KEY(week.weekStart), "1");
			} catch {
				/* storage unavailable: hidden for this visit only */
			}
			setDismissed(true);
		}
		onClose();
	};
	const saveGoal = async () => {
		setSaving("saving");
		try {
			const r = await fetch("/api/program/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ weekGoals: { [plan.goalWeek]: goal } }),
			});
			if (!r.ok) throw new Error();
			setSaving("saved");
			onChanged();
		} catch {
			setSaving("error");
		}
	};
	const title = plan.summarize === "last" ? "Last week" : new Date(`${today}T00:00:00Z`).getUTCDay() === 0 ? "This week" : "This week so far";
	const target = s.weekly.thisWeek.target;

	return (
		<section className="rounded-xl border border-border bg-card p-4" data-testid="weekly-review" aria-label="Weekly review">
			<div className="flex items-start gap-2">
				<h2 className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
					<CalendarCheckIcon className="size-3.5" /> {title} · {fmtDay(week.weekStart)} – {fmtDay(week.weekEnd)}
				</h2>
				<button
					type="button"
					onClick={close}
					aria-label="Dismiss weekly review"
					className="-m-1 ml-auto flex items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11"
				>
					<XIcon className="size-4" />
				</button>
			</div>

			<p className="mt-2 text-[15px] font-semibold">{encouragement(week)}</p>

			<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
				<div>
					<div className="text-[11px] uppercase tracking-wider text-muted-foreground">Lessons</div>
					<div className="mt-0.5 flex items-center gap-2">
						<span className="text-xl font-semibold tabular-nums">
							{week.finished}/{target}
						</span>
						<WeekDots finished={week.finished} target={target} />
					</div>
					<div className="text-xs text-muted-foreground">
						{week.met ? (
							<span className="inline-flex items-center gap-0.5 text-[var(--st-mastered)]">
								<CheckIcon className="size-3" /> week met
							</span>
						) : (
							"not met"
						)}
						{week.testedOut > 0 ? ` · ${week.testedOut} tested out` : ""}
					</div>
				</div>
				<div>
					<div className="text-[11px] uppercase tracking-wider text-muted-foreground">Studied</div>
					<div className="mt-0.5 text-xl font-semibold tabular-nums">{(week.minutes / 60).toFixed(1)} h</div>
				</div>
				<div>
					<div className="text-[11px] uppercase tracking-wider text-muted-foreground">Practice</div>
					<div className="mt-0.5 text-sm tabular-nums">
						{week.quizzes} quiz{week.quizzes === 1 ? "" : "zes"}
						<br />
						{week.reviews} review{week.reviews === 1 ? "" : "s"}
					</div>
				</div>
			</div>

			{paceRows.length > 0 && (
				<div className="mt-3 flex flex-wrap gap-2">
					{paceRows.map(({ course, unit, pace }) => (
						<Link
							key={unit.id}
							href={`/program/course/${course.id}`}
							className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs hover:bg-accent pointer-coarse:min-h-11"
							style={{ borderColor: PACE_COLOR[pace.status] }}
						>
							<span style={{ color: TRACK_COLOR[course.track] }}>{course.code}</span>
							<span className="min-w-0 max-w-40 truncate">{unit.title}</span>
							<span style={{ color: PACE_COLOR[pace.status] }}>{PACE_LABEL[pace.status]}</span>
							<span className="text-muted-foreground tabular-nums">
								· {pace.perDayNeeded.toFixed(1)}
								<span className="max-sm:hidden"> lessons</span>/day
							</span>
						</Link>
					))}
				</div>
			)}

			<form
				className="mt-3 border-t border-border pt-3"
				onSubmit={(e) => {
					e.preventDefault();
					void saveGoal();
				}}
			>
				<label htmlFor="week-goal" className="text-xs text-muted-foreground">
					One goal for {plan.goalWeek === weekStart(today) ? "this week" : "next week"}
				</label>
				<div className="mt-1 flex gap-2">
					<input
						id="week-goal"
						value={goal}
						maxLength={200}
						onChange={(e) => {
							setGoal(e.target.value);
							setSaving("idle");
						}}
						placeholder="e.g. Finish the trig unit"
						className="lh-input min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm pointer-coarse:min-h-11"
					/>
					<button
						type="submit"
						disabled={saving === "saving" || goal.trim() === savedGoal}
						className="shrink-0 rounded-lg bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50 pointer-coarse:min-h-11"
					>
						{saving === "saved" && goal.trim() === savedGoal ? "Saved" : "Save"}
					</button>
				</div>
				{saving === "error" && <p className="mt-1 text-xs text-destructive">Couldn&apos;t save the goal — try again.</p>}
			</form>
		</section>
	);
}
