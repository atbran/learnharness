"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, PartyPopperIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { QuickCheck } from "./quick-check";

interface ReviewItem {
	lessonId: string;
	title: string;
	courseCode: string;
	/** Missed-question retake: just these quiz question indexes. */
	only?: number[];
}

/** Review: first the quiz questions missed on earlier days (just those),
 *  then the spaced-review lessons due, each a retake of its quick check's
 *  auto-graded questions (no model call). */
export function ReviewSession({ missed, due: spaced }: { missed: ReviewItem[]; due: ReviewItem[] }) {
	const [i, setI] = useState(0);
	const [done, setDone] = useState(false);
	const due = [...missed, ...spaced];
	const cur = due[i];
	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span>
						Review {due.length ? `${Math.min(i + 1, due.length)}/${due.length}` : ""}
					</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl space-y-4 px-6 py-6 max-sm:px-4">
					{!cur ? (
						<div className="rounded-xl border border-border bg-card p-8 text-center">
							<PartyPopperIcon className="mx-auto size-8 text-[var(--st-review)]" />
							<p className="mt-3 text-sm text-muted-foreground">No reviews due. Mastered lessons come back here on a spaced schedule, and questions you miss come back the next day.</p>
							<Link href="/program" className="mt-4 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent pointer-coarse:min-h-11">
								Back to the program
							</Link>
						</div>
					) : (
						<>
							<div className="text-xs uppercase tracking-wider text-muted-foreground">
								{cur.only ? "Missed questions · " : ""}
								{cur.courseCode} · <Link href={`/program/lesson/${cur.lessonId}`} className="hover:text-foreground">{cur.title}</Link>
							</div>
							{cur.only ? (
								<QuickCheck key={`missed-${cur.lessonId}`} lessonId={cur.lessonId} only={cur.only} missedRetake onDone={() => setDone(true)} />
							) : (
								<QuickCheck key={cur.lessonId} lessonId={cur.lessonId} review onDone={() => setDone(true)} />
							)}
							{done && (
								<button
									type="button"
									onClick={() => {
										setDone(false);
										setI((x) => x + 1);
									}}
									className="w-full rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent pointer-coarse:min-h-11"
								>
									{i + 1 < due.length ? "Next review →" : "Finish"}
								</button>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
