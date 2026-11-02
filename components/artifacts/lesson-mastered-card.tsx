"use client";

import { CheckCircle2Icon } from "lucide-react";

/**
 * The tutor's lesson_mastered call (owner 2026-11-01): a success is the
 * learner's — "Lesson mastered" with the tutor's summary of what they can
 * now do. A refusal (a plan step still unproven) is model-facing
 * bookkeeping, kept quiet and small for transcript honesty; the tutor goes
 * on to check the steps it names.
 */
export function LessonMasteredCard({ part }: { part: { input?: unknown; output?: unknown; state?: unknown } }) {
	const output = part.output as { ok?: boolean; alreadyMastered?: boolean; error?: string } | undefined;
	const summary = (part.input as { summary?: unknown } | undefined)?.summary;
	if (!output) return null;
	if (!output.ok)
		return (
			<p data-testid="lesson-mastered-refused" className="my-2 text-xs text-muted-foreground">
				The tutor checked whether this lesson is mastered — not yet; a step still needs a passed check.
			</p>
		);
	return (
		<div data-testid="lesson-mastered-card" className="my-3 rounded-xl border border-[var(--st-mastered)]/40 bg-card/60 p-3">
			<div className="mb-1 flex items-center gap-2 text-sm font-semibold">
				<CheckCircle2Icon className="size-4 text-[var(--st-mastered)]" />
				{output.alreadyMastered ? "Lesson already mastered" : "Lesson mastered"}
			</div>
			{typeof summary === "string" && summary.trim() && <p className="text-sm text-muted-foreground">{summary}</p>}
			{!output.alreadyMastered && (
				<p className="mt-1 text-xs text-muted-foreground">Counted like a passing quick check: the next lessons unlock and its spaced review is scheduled.</p>
			)}
		</div>
	);
}
