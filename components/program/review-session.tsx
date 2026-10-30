"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, PartyPopperIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { QuickCheck } from "./quick-check";

/** Spaced review: the due lessons one after another, each a retake of its
 *  cached quick check's auto-graded questions (no model call). */
export function ReviewSession({ due }: { due: { lessonId: string; title: string; courseCode: string }[] }) {
	const [i, setI] = useState(0);
	const [done, setDone] = useState(false);
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
				<div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
					{!cur ? (
						<div className="rounded-xl border border-border bg-card p-8 text-center">
							<PartyPopperIcon className="mx-auto size-8 text-[var(--st-review)]" />
							<p className="mt-3 text-sm text-muted-foreground">No reviews due. Mastered lessons come back here on a spaced schedule.</p>
							<Link href="/program" className="mt-4 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent pointer-coarse:min-h-11">
								Back to the program
							</Link>
						</div>
					) : (
						<>
							<div className="text-xs uppercase tracking-wider text-muted-foreground">
								{cur.courseCode} · <Link href={`/program/lesson/${cur.lessonId}`} className="hover:text-foreground">{cur.title}</Link>
							</div>
							<QuickCheck key={cur.lessonId} lessonId={cur.lessonId} review onDone={() => setDone(true)} />
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
