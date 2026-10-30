"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpenIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LessonContextData } from "@/src/core";

/**
 * The lesson-context card: message[0] of a session started from a physics
 * program lesson. Scaffolding, like the graph-context card: collapsed by
 * default, it names the lesson (linking back to its page) and expands to
 * the objectives and assigned readings the tutor was briefed with.
 */
export function LessonContextCard({ data }: { data: LessonContextData }) {
	const [open, setOpen] = useState(false);
	if (!data) return null;
	return (
		<div data-testid="lesson-context-card" className="my-1">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon aria-hidden="true" className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
				<BookOpenIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="font-medium">
					{data.courseCode} · {data.mode === "practice" ? "Practice" : "Lesson"}
				</span>
				<span className="min-w-0 flex-1 truncate">{data.lessonTitle}</span>
			</button>
			{open && (
				<div className="mt-1 space-y-2 rounded-lg border border-dashed border-border/70 px-4 py-3 text-xs">
					<div className="text-muted-foreground">
						{data.courseTitle} › {data.unitTitle} ›{" "}
						<Link href={`/program/lesson/${data.lessonId}`} className="text-foreground underline-offset-2 hover:underline">
							{data.lessonTitle}
						</Link>
					</div>
					<ul className="list-disc space-y-0.5 pl-4 text-foreground/80">
						{data.objectives.map((o, i) => (
							<li key={i}>{o}</li>
						))}
					</ul>
					{data.readings.length > 0 && (
						<div className="text-muted-foreground">
							Reading: {data.readings.map((r) => (r.pages ? `${r.label} (pp. ${r.pages})` : r.label)).join(" · ")}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
