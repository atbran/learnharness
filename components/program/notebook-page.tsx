"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BookMarkedIcon, ChevronRightIcon, PrinterIcon, Trash2Icon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { TopBar } from "@/components/top-bar";
import { cn } from "@/lib/utils";
import { PaperView } from "./paper-view";
import { TRACK_COLOR } from "./status";
import { entryDate, Feedback, useNotebook, type NotebookEntry } from "./teach-back";
import { useProgram, type ProgramView } from "./use-program";

interface Group {
	course: { id: string; code: string; title: string; track: string } | null;
	units: { id: string; title: string; entries: { entry: NotebookEntry; lessonTitle: string | null }[] }[];
}

/** Entries grouped by course, then unit, in program order (lessons in
 *  program order, each lesson's explanations newest first). Entries whose
 *  lesson is no longer in the program go last, under "Other". */
function groupEntries(program: ProgramView | undefined, entries: NotebookEntry[]): Group[] {
	const byLesson = new Map<string, NotebookEntry[]>();
	for (const e of entries) byLesson.set(e.lessonId, [...(byLesson.get(e.lessonId) ?? []), e]);
	const groups: Group[] = [];
	const placed = new Set<string>();
	for (const c of program?.courses ?? []) {
		const units: Group["units"] = [];
		for (const u of c.units) {
			const rows = u.lessons.flatMap((l) => {
				placed.add(l.id);
				return (byLesson.get(l.id) ?? []).map((entry) => ({ entry, lessonTitle: l.title }));
			});
			if (rows.length) units.push({ id: u.id, title: u.title, entries: rows });
		}
		if (units.length) groups.push({ course: { id: c.id, code: c.code, title: c.title, track: c.track }, units });
	}
	const rest = entries.filter((e) => !placed.has(e.lessonId));
	if (rest.length) groups.push({ course: null, units: [{ id: "other", title: "Other", entries: rest.map((entry) => ({ entry, lessonTitle: null })) }] });
	return groups;
}

/**
 * The notebook: every teach-back explanation, grouped by course and unit in
 * program order, with its feedback. `print` shows it as paper (PaperView).
 */
export function NotebookPage({ print }: { print: boolean }) {
	const { data } = useProgram(null);
	const { entries, setEntries } = useNotebook();
	const groups = useMemo(() => (entries && data ? groupEntries(data.program, entries) : null), [entries, data]);

	async function remove(e: NotebookEntry, lessonTitle: string | null) {
		if (!window.confirm(`Delete your explanation of ${lessonTitle ? `“${lessonTitle}”` : "this lesson"} from ${entryDate(e.at)}?`)) return;
		setEntries((es) => (es ?? []).filter((x) => x.id !== e.id));
		await fetch(`/api/program/notebook?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
	}

	if (print) return <NotebookPaper groups={groups} />;

	const count = entries?.length ?? 0;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span>Notebook</span>
				</div>
				{count > 0 && (
					<Link href="/program/notebook?print=1" className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent pointer-coarse:min-h-11">
						<PrinterIcon className="size-4" /> Print
					</Link>
				)}
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[900px] space-y-6 px-6 py-5 max-sm:px-4">
					<header>
						<h1 className="font-title text-4xl tracking-tight max-sm:text-3xl">Notebook</h1>
						<p className="mt-1 text-sm text-muted-foreground">The lessons you&apos;ve explained in your own words, in program order.</p>
					</header>

					{groups === null ? (
						<div className="h-32 animate-pulse rounded-xl bg-card" />
					) : groups.length === 0 ? (
						<div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="notebook-empty">
							<BookMarkedIcon className="mx-auto mb-2 size-6" />
							<p className="font-medium text-foreground">Your notebook is empty.</p>
							<p className="mx-auto mt-1 max-w-md">
								Once you master a lesson, its page offers <span className="text-foreground">Teach it back</span>: explain the lesson in your own words and
								it lands here with brief feedback, or teach it to the tutor. Explaining something is the surest test that you know it.
							</p>
						</div>
					) : (
						groups.map((g) => (
							<section key={g.course?.id ?? "other"} className="space-y-4">
								<h2 className="flex items-baseline gap-2 border-b border-border pb-1.5">
									{g.course ? (
										<>
											<span className="text-sm font-semibold" style={{ color: TRACK_COLOR[g.course.track] }}>
												{g.course.code}
											</span>
											<span className="text-sm text-muted-foreground">{g.course.title}</span>
										</>
									) : (
										<span className="text-sm text-muted-foreground">Lessons no longer in the program</span>
									)}
								</h2>
								{g.units.map((u) => (
									<div key={u.id} className="space-y-2">
										{g.course && <h3 className="text-xs uppercase tracking-wider text-muted-foreground">{u.title}</h3>}
										<ul className="space-y-2">
											{u.entries.map(({ entry: e, lessonTitle }) => (
												<li key={e.id} className="rounded-xl border border-border bg-card p-4" data-testid="notebook-entry">
													<div className="flex items-start gap-3">
														<div className="min-w-0 flex-1">
															<Link href={`/program/lesson/${e.lessonId}`} className="font-medium hover:underline">
																{lessonTitle ?? e.lessonId}
															</Link>
															<div className="text-xs text-muted-foreground">{entryDate(e.at)}</div>
														</div>
														<button
															type="button"
															onClick={() => void remove(e, lessonTitle)}
															aria-label="Delete explanation"
															title="Delete explanation"
															className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11"
														>
															<Trash2Icon className="size-4" />
														</button>
													</div>
													<div className="mt-2 text-[15px]">
														<MessageResponse className="h-auto!">{e.text}</MessageResponse>
													</div>
													<Feedback entry={e} className="mt-3 border-t border-border pt-2" />
												</li>
											))}
										</ul>
									</div>
								))}
							</section>
						))
					)}
				</div>
			</div>
		</div>
	);
}

function NotebookPaper({ groups }: { groups: Group[] | null }) {
	const ready = !!groups && groups.length > 0;
	return (
		<PaperView back={{ href: "/program/notebook", label: "Notebook" }} ready={ready}>
			<div className="mx-auto my-6 max-w-[8.5in] print:my-0 print:max-w-none">
				<section className="lh-page bg-white p-[0.6in] shadow max-sm:p-5 print:p-0 print:shadow-none">
					<header className="border-b border-neutral-300 pb-2">
						<h1 className="text-xl font-semibold">My physics notebook</h1>
						<div className="text-xs text-neutral-600">Lessons explained in my own words · {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
					</header>
					{!groups ? (
						<p className="mt-4 text-sm text-neutral-600">Loading…</p>
					) : groups.length === 0 ? (
						<p className="mt-4 text-sm text-neutral-600">No explanations yet.</p>
					) : (
						groups.map((g) => (
							<div key={g.course?.id ?? "other"} className="mt-5">
								<h2 className="text-base font-semibold">{g.course ? `${g.course.code} · ${g.course.title}` : "Other lessons"}</h2>
								{g.units.map((u) => (
									<div key={u.id} className="mt-3">
										{g.course && <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{u.title}</h3>}
										{u.entries.map(({ entry: e, lessonTitle }) => (
											<article key={e.id} className="mt-2 break-inside-avoid">
												<div className="flex items-baseline justify-between gap-3">
													<h4 className="text-[14px] font-semibold">{lessonTitle ?? e.lessonId}</h4>
													<span className="shrink-0 text-[11px] text-neutral-500">{entryDate(e.at)}</span>
												</div>
												<div className="text-[13px] leading-relaxed [--lh-prose-size:13px]">
													<MessageResponse className="h-auto!">{e.text}</MessageResponse>
												</div>
												{e.feedback && (
													<div className={cn("mt-1 border-l-2 pl-2 text-[11.5px] text-neutral-600 [--lh-prose-size:11.5px]", e.accurate === false ? "border-amber-500" : "border-neutral-300")}>
														{e.accurate !== null && <div className="font-semibold">{e.accurate ? "✓ Accurate" : "Check this"}</div>}
														<MessageResponse className="h-auto!">{e.feedback}</MessageResponse>
													</div>
												)}
											</article>
										))}
									</div>
								))}
							</div>
						))
					)}
				</section>
			</div>
		</PaperView>
	);
}
