"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	ChevronRightIcon,
	ClipboardListIcon,
	DumbbellIcon,
	FileCheck2Icon,
	FileTextIcon,
	GaugeIcon,
	Loader2Icon,
	MonitorPlayIcon,
	MoreHorizontalIcon,
	SparklesIcon,
} from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { MenuShell } from "@/components/menu-shell";
import { Toggle } from "@/components/settings/controls";
import { cn } from "@/lib/utils";
import type { ProgressSnapshot } from "@/src/core";
import { ProgressRing } from "./charts";
import { STATUS_COLOR, STATUS_LABEL, TRACK_COLOR, pct } from "./status";
import { useProgram, type CourseView, type ProgramData, type UnitView } from "./use-program";

type UnitProgress = ProgressSnapshot["units"][string];
type UnitPace = NonNullable<UnitProgress["pace"]>;

const PACE_CHIP: Record<UnitPace["status"], { label: string; color: string }> = {
	upcoming: { label: "Upcoming", color: "var(--muted-foreground)" },
	ahead: { label: "Ahead", color: "var(--st-mastered)" },
	"on-track": { label: "On track", color: "var(--st-available)" },
	behind: { label: "Behind", color: "var(--st-progress)" },
	done: { label: "Done", color: "var(--st-mastered)" },
};

async function putSettings(patch: Record<string, unknown>): Promise<void> {
	await fetch("/api/program/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
}

/** One course: header with mastery, units as lanes of lesson tiles, the
 *  unit problem sets and the course exams. */
export function CoursePage({ courseId, initial }: { courseId: string; initial: ProgramData | null }) {
	const { data, refresh } = useProgram(initial);
	// A settings change shows at once; the overlay lapses when the next
	// program fetch (a new settings object) lands.
	const [pending, setPending] = useState<{ base: ProgramData["settings"]; patch: Partial<ProgramData["settings"]> } | null>(null);
	if (!data) return null;
	const course = data.program.courses.find((c) => c.id === courseId);
	if (!course) return <div className="p-8 text-sm text-muted-foreground">Unknown course.</div>;
	const s = data.snapshot;
	const cp = s.courses[course.id];
	const color = TRACK_COLOR[course.track];
	const prereqs = data.program.courses.filter((c) => course.prereqs.includes(c.id));
	const coreqs = data.program.courses.filter((c) => course.coreqs.includes(c.id) || c.coreqs.includes(course.id));
	const live = pending?.base === data.settings ? pending.patch : {};
	const { reviewMode, unitWeeks } = { ...data.settings, ...live };
	const save = (patch: Partial<ProgramData["settings"]>) => {
		setPending({ base: data.settings, patch: { ...live, ...patch } });
		void putSettings(patch).then(refresh);
	};
	const courseReview = reviewMode.includes(course.id);
	const setReview = (id: string, on: boolean) => save({ reviewMode: on ? [...reviewMode.filter((x) => x !== id), id] : reviewMode.filter((x) => x !== id) });
	const setWeeks = (unitId: string, weeks: number | null) => {
		const next = { ...unitWeeks };
		if (weeks === null) delete next[unitId];
		else next[unitId] = weeks;
		save({ unitWeeks: next });
	};
	// The course total: each unit's target, or its computed share once any
	// unit in the course has a target (the server then paces every unit).
	const paced = course.units.some((u) => s.units[u.id]?.pace);
	const totalWeeks = course.units.reduce((n, u) => n + (unitWeeks[u.id] ?? s.units[u.id]?.pace?.weeks ?? 0), 0);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span style={{ color }}>{course.code}</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[1200px] space-y-6 px-6 py-5 max-sm:px-4">
					<header className="flex flex-wrap items-center gap-5">
						<ProgressRing value={cp?.fraction ?? 0} size={88} stroke={8} color={color}>
							<span className="text-base">{pct(cp?.fraction ?? 0)}</span>
						</ProgressRing>
						<div className="min-w-0 flex-1 max-sm:order-first max-sm:basis-full">
							<div className="text-xs uppercase tracking-wider" style={{ color }}>
								{course.code} · {course.depth} · {course.hours} h
							</div>
							<h1 className="font-title text-4xl leading-tight tracking-tight max-sm:text-3xl">{course.title}</h1>
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
							<div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
								<ReviewToggle
									checked={courseReview}
									onChange={(on) => setReview(course.id, on)}
									label="Review mode"
									hint="Every lesson in this course opens fast-track"
									testid="course-review-mode"
								/>
								<span className="flex items-center gap-1.5" data-testid="course-pace-total">
									<GaugeIcon className="size-3.5 shrink-0" />
									{paced ? (
										<span>
											Pace: <span className="text-foreground">{fmtWeeks(totalWeeks)}</span> across {course.units.length} units
										</span>
									) : (
										"Set target weeks on a unit to pace this course"
									)}
								</span>
							</div>
						</div>
						<div className="grid grid-cols-3 gap-3 text-center text-xs text-muted-foreground max-lg:w-full max-sm:w-auto max-sm:flex-1 max-sm:gap-2">
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
										<div className="ml-auto flex flex-wrap items-center gap-2 max-sm:w-full">
											<div className="mr-1 h-1.5 w-32 overflow-hidden rounded bg-accent max-sm:order-first max-sm:mr-0 max-sm:min-w-[calc(100%-3.5rem)] max-sm:flex-1">
												<div className="h-full bg-[var(--st-mastered)]" style={{ width: pct((up?.mastered ?? 0) / Math.max(1, up?.total ?? 1)) }} />
											</div>
											<Link
												href={`/program/assessment/new?unit=${u.id}`}
												className={cn(
													"flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs hover:bg-accent pointer-coarse:min-h-11",
													up?.passed ? "border-[var(--st-mastered)] text-[var(--st-mastered)]" : "border-border",
												)}
											>
												<ClipboardListIcon className="size-3.5" /> Problem set{up?.psetBest != null ? ` · ${pct(up.psetBest)}` : ""}
											</Link>
											<UnitActions course={course} unit={u} up={up} lessons={s.lessons} />
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
									<UnitFooter
										unitId={u.id}
										up={up}
										weeks={unitWeeks[u.id]}
										onWeeks={(w) => setWeeks(u.id, w)}
										review={courseReview || reviewMode.includes(u.id)}
										reviewLocked={courseReview}
										onReview={(on) => setReview(u.id, on)}
									/>
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
		<div className="rounded-lg border border-border px-3 py-2 max-sm:px-1.5">
			<div className="text-lg font-semibold text-foreground">{value}</div>
			{label}
		</div>
	);
}

function fmtWeeks(w: number): string {
	const n = Math.round(w * 100) / 100;
	return `${n} week${n === 1 ? "" : "s"}`;
}

function fmtDay(iso: string): string {
	const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
	const sameYear = d.getUTCFullYear() === new Date().getFullYear();
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** A labelled switch; the whole label is the hit area on touch. */
function ReviewToggle({
	checked,
	onChange,
	label,
	hint,
	disabled,
	testid,
}: {
	checked: boolean;
	onChange: (on: boolean) => void;
	label: string;
	hint: string;
	disabled?: boolean;
	testid: string;
}) {
	return (
		<label className={cn("flex items-center gap-2 pointer-coarse:min-h-11", disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer")} title={hint} data-testid={testid}>
			<Toggle checked={checked} disabled={disabled} onChange={onChange} label={`${label}: ${hint}`} />
			<span>{label}</span>
		</label>
	);
}

/** Test out, mixed drill and practice sheet. On phones the drill and the
 *  sheet fold into an overflow menu. */
function UnitActions({ course, unit, up, lessons }: { course: CourseView; unit: UnitView; up: UnitProgress | undefined; lessons: ProgressSnapshot["lessons"] }) {
	const router = useRouter();
	const [starting, setStarting] = useState(false);
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const menuId = `unit-more-${unit.id}`;
	useEffect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target;
			if (t instanceof Element && t.closest(`[data-testid="${menuId}"]`)) return;
			if (!(t instanceof Node) || !trigger.current?.contains(t)) setOpen(false);
		};
		// MenuShell focuses its own body, so Escape is caught at the document.
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen(false);
			trigger.current?.focus();
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, menuId]);

	const fullyMastered = !!up && up.total > 0 && up.mastered >= up.total;
	const touched = unit.lessons.filter((l) => {
		const lp = lessons[l.id];
		return !!lp && (lp.started || lp.status === "mastered" || lp.masteredAt !== null);
	}).length;
	const canDrill = touched >= 2;
	const sheetHref = `/program/assessment/new?sheet=1&unit=${unit.id}`;

	async function startDrill() {
		setStarting(true);
		try {
			const res = await fetch("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: `${course.code} · ${unit.title}`, unitId: unit.id, kind: "practice" }),
			});
			const body = (await res.json()) as { id?: string };
			if (!res.ok || !body.id) throw new Error("could not create the session");
			router.push(`/chat/${body.id}?prompt=${encodeURIComponent("Give me a mixed drill for this unit.")}`);
		} catch {
			setStarting(false);
		}
	}

	const btn = "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-60 pointer-coarse:min-h-11";
	const item = "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-accent disabled:opacity-60 pointer-coarse:min-h-11";
	const drill = (cls: string) => (
		<button type="button" disabled={starting} onClick={() => void startDrill()} className={cls} data-testid={`drill-${unit.id}`}>
			{starting ? <Loader2Icon className="size-3.5 animate-spin" /> : <DumbbellIcon className="size-3.5" />} Mixed drill
		</button>
	);
	const sheet = (cls: string) => (
		<Link href={sheetHref} className={cls} data-testid={`sheet-${unit.id}`}>
			<FileTextIcon className="size-3.5" /> Practice sheet
		</Link>
	);
	return (
		<>
			{!fullyMastered && (
				<Link
					href={`/program/diagnostic/${unit.id}`}
					className={cn(btn, !up?.diagnosedAt && "border-[var(--st-review)] text-[var(--st-review)]")}
					data-testid={`test-out-${unit.id}`}
				>
					<FileCheck2Icon className="size-3.5" /> {up?.diagnosedAt ? "Retake the test-out" : "Test out of this unit"}
				</Link>
			)}
			<span className="contents max-sm:hidden">
				{canDrill && drill(btn)}
				{sheet(btn)}
			</span>
			<button
				ref={trigger}
				type="button"
				aria-label="More unit actions"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-accent max-sm:order-first sm:hidden pointer-coarse:size-11"
			>
				<MoreHorizontalIcon className="size-4" />
			</button>
			{open && (
				<MenuShell anchorRef={trigger} testid={menuId} preferredSide="down" menuClass="flex w-52 flex-col rounded-xl border border-border bg-card p-1.5 text-sm shadow-xl">
					{canDrill && drill(item)}
					{sheet(item)}
				</MenuShell>
			)}
		</>
	);
}

/** Review mode for the unit and its pace: target weeks, the target window,
 *  the lessons a day it needs, and whether it's ahead or behind. */
function UnitFooter({
	unitId,
	up,
	weeks,
	onWeeks,
	review,
	reviewLocked,
	onReview,
}: {
	unitId: string;
	up: UnitProgress | undefined;
	weeks: number | undefined;
	onWeeks: (w: number | null) => void;
	review: boolean;
	reviewLocked: boolean;
	onReview: (on: boolean) => void;
}) {
	const pace = up?.pace ?? null;
	const chip = pace ? PACE_CHIP[pace.status] : null;
	return (
		<div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
			<ReviewToggle
				checked={review}
				disabled={reviewLocked}
				onChange={onReview}
				label="Review mode"
				hint={reviewLocked ? "On for the whole course" : "This unit's lessons open fast-track"}
				testid={`review-mode-${unitId}`}
			/>
			<WeeksInput value={weeks} placeholder={pace ? String(Math.round(pace.weeks * 100) / 100) : "—"} onCommit={onWeeks} unitId={unitId} />
			{pace && (
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid={`pace-${unitId}`}>
					<span className="whitespace-nowrap">
						{fmtDay(pace.targetStart)} – {fmtDay(pace.targetEnd)}
					</span>
					<span aria-hidden>·</span>
					<span className="whitespace-nowrap">{pace.status === "done" || pace.lessonsLeft === 0 ? "done" : `${pace.perDayNeeded.toFixed(1)} lessons/day needed`}</span>
					{chip && (
						<span className="rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap" style={{ borderColor: chip.color, color: chip.color }}>
							{chip.label}
						</span>
					)}
				</span>
			)}
		</div>
	);
}

/** Target weeks, committed on blur or Enter; empty clears the target. */
function WeeksInput({ value, placeholder, onCommit, unitId }: { value: number | undefined; placeholder: string; onCommit: (w: number | null) => void; unitId: string }) {
	const [draft, setDraft] = useState<string | null>(null);
	const cancelled = useRef(false);
	const commit = () => {
		if (cancelled.current) {
			cancelled.current = false;
			return setDraft(null);
		}
		if (draft === null) return;
		const t = draft.trim();
		setDraft(null);
		if (t === "") {
			if (value !== undefined) onCommit(null);
			return;
		}
		const n = Number(t);
		if (!Number.isFinite(n)) return;
		const w = Math.min(12, Math.max(0.25, Math.round(n * 4) / 4));
		if (w !== value) onCommit(w);
	};
	return (
		<label className="flex items-center gap-1.5 whitespace-nowrap">
			Target
			<input
				type="number"
				inputMode="decimal"
				min={0.25}
				max={12}
				step={0.25}
				value={draft ?? (value !== undefined ? String(value) : "")}
				placeholder={placeholder}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") {
						cancelled.current = true;
						e.currentTarget.blur();
					}
				}}
				aria-label="Target weeks for this unit"
				data-testid={`weeks-${unitId}`}
				className="lh-input w-16 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground pointer-coarse:min-h-11"
			/>
			weeks
		</label>
	);
}
