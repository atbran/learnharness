"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { useServerEvent } from "@/components/server-events";
import { CheckQuestionField, type PublicQ } from "./quick-check";

type DiagnosticQ = PublicQ & { lessonId: string };
type DiagnosticState = { status: "ready"; questions: DiagnosticQ[] } | { status: "generating" | "missing" } | { status: "error"; error: string };
type Outcome = "tested-out" | "fast-track" | "full";
interface Result {
	unitId: string;
	lessons: { lessonId: string; correct: number; outcome: Outcome }[];
	perQuestion: { correct: boolean; feedback: string }[];
}

const OUTCOME: Record<Outcome, { mark: string; label: string; color: string }> = {
	"tested-out": { mark: "✓", label: "Tested out", color: "var(--st-mastered)" },
	"fast-track": { mark: "◐", label: "Fast track", color: "var(--st-progress)" },
	full: { mark: "○", label: "Full lesson", color: "var(--st-available)" },
};

/** A unit's test-out diagnostic: two questions per lesson, graded on the
 *  server. 2/2 tests the lesson out, 1/2 opens it in fast-track. */
export function UnitDiagnosticPage({
	unitId,
	unitTitle,
	courseId,
	courseCode,
	lessons,
}: {
	unitId: string;
	unitTitle: string;
	courseId: string;
	courseCode: string;
	lessons: { id: string; title: string }[];
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0" />
					<Link href={`/program/course/${courseId}`} className="truncate hover:text-foreground pointer-coarse:py-3">
						{courseCode}
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0" />
					<span className="whitespace-nowrap">Test out</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto" id="diagnostic-scroll">
				<div className="mx-auto max-w-3xl space-y-5 px-6 py-6 max-sm:px-4">
					<header>
						<h1 className="font-title text-3xl leading-tight tracking-tight">Test out · {unitTitle}</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Two questions per lesson. Get both right and the lesson is skipped; get one right and it opens in fast-track.
						</p>
					</header>
					<UnitDiagnostic unitId={unitId} lessons={lessons} />
				</div>
			</div>
		</div>
	);
}

function UnitDiagnostic({ unitId, lessons }: { unitId: string; lessons: { id: string; title: string }[] }) {
	const [state, setState] = useState<DiagnosticState | null>(null);
	const [answers, setAnswers] = useState<string[]>([]);
	const [result, setResult] = useState<Result | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const setAnswer = (i: number) => (v: string) => setAnswers((a) => Object.assign([...a], { [i]: v }));

	const load = useCallback(() => {
		void fetch(`/api/program/diagnostics/${unitId}`)
			.then((r) => r.json())
			.then((s: DiagnosticState) => setState(s));
	}, [unitId]);
	useEffect(load, [load]);
	useServerEvent("curriculum-changed", () => {
		if (state?.status === "generating") load();
	});

	const generate = async () => {
		setState({ status: "generating" });
		const r = await fetch(`/api/program/diagnostics/${unitId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generate: true }) });
		const body = (await r.json()) as DiagnosticState & { error?: string };
		setState(r.ok ? body : { status: "error", error: body.error ?? "could not start the diagnostic" });
	};

	if (!state) return <Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />;
	if (state.status !== "ready")
		return (
			<div className="rounded-xl border border-border bg-card p-6 text-center">
				{state.status === "generating" ? (
					<>
						<Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />
						<p className="mt-3 text-sm text-muted-foreground">Writing the diagnostic for this unit… (a minute or two, once — it&apos;s saved for retakes)</p>
					</>
				) : (
					<>
						{state.status === "error" && <p className="mb-3 text-sm text-destructive">{state.error}</p>}
						<p className="text-sm text-muted-foreground">
							{state.status === "error" ? "The diagnostic could not be written." : "Two fresh questions on each lesson in this unit, graded instantly."}
						</p>
						<button
							type="button"
							onClick={() => void generate()}
							className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground pointer-coarse:min-h-11"
						>
							{state.status === "error" ? "Try again" : "Write the diagnostic"}
						</button>
					</>
				)}
			</div>
		);

	const qs = state.questions.map((q, i) => ({ q, i }));
	const groups = lessons.map((l) => ({ lesson: l, items: qs.filter((x) => x.q.lessonId === l.id) })).filter((g) => g.items.length > 0);
	const outcomeOf = new Map(result?.lessons.map((l) => [l.lessonId, l]) ?? []);
	const firstNeeded = result?.lessons.find((l) => l.outcome !== "tested-out");
	const titleOf = new Map(lessons.map((l) => [l.id, l.title]));
	const countOf = (lessonId: string) => state.questions.filter((q) => q.lessonId === lessonId).length;

	const submit = async () => {
		setSubmitting(true);
		setError(null);
		const r = await fetch(`/api/program/diagnostics/${unitId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ responses: state.questions.map((_, i) => answers[i] ?? "") }),
		});
		const body = (await r.json()) as Result & { error?: string };
		setSubmitting(false);
		if (!r.ok) return setError(body.error ?? "grading failed");
		setResult(body);
		document.getElementById("diagnostic-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
	};

	return (
		<div className="space-y-5">
			{result && (
				<section className="rounded-xl border border-border bg-card p-4" data-testid="diagnostic-results">
					<h2 className="mb-2 text-sm font-semibold">Your results</h2>
					<ul className="divide-y divide-border">
						{result.lessons.map((l) => {
							const o = OUTCOME[l.outcome];
							return (
								<li key={l.lessonId}>
									<Link href={`/program/lesson/${l.lessonId}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-accent pointer-coarse:min-h-11">
										<span className="w-4 shrink-0 text-center text-base" style={{ color: o.color }} aria-hidden>
											{o.mark}
										</span>
										<span className="min-w-0 flex-1 truncate">{titleOf.get(l.lessonId) ?? l.lessonId}</span>
										<span className="shrink-0 text-xs whitespace-nowrap" style={{ color: o.color }}>
											{o.label} · {l.correct}/{countOf(l.lessonId)}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
					<div className="mt-3 flex flex-wrap gap-2">
						{firstNeeded ? (
							<Link
								href={`/program/lesson/${firstNeeded.lessonId}`}
								className="flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground pointer-coarse:min-h-11"
							>
								Start the first lesson you need
							</Link>
						) : (
							<p className="py-2 text-sm text-[var(--st-mastered)]">You tested out of every lesson in this unit.</p>
						)}
					</div>
				</section>
			)}
			{groups.map(({ lesson, items }) => {
				const o = outcomeOf.get(lesson.id);
				return (
					<section key={lesson.id} className="space-y-3">
						<h2 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-base font-semibold">
							<Link href={`/program/lesson/${lesson.id}`} className="hover:underline">
								{lesson.title}
							</Link>
							{o && (
								<span className="text-xs font-normal" style={{ color: OUTCOME[o.outcome].color }}>
									{OUTCOME[o.outcome].mark} {OUTCOME[o.outcome].label}
								</span>
							)}
						</h2>
						{items.map(({ q, i }) => (
							<CheckQuestionField key={i} q={q} index={i} value={answers[i] ?? ""} onChange={setAnswer(i)} locked={!!result || submitting} result={result?.perQuestion[i]} />
						))}
					</section>
				);
			})}
			{error && <div className="text-sm text-destructive">{error}</div>}
			{!result && (
				<button
					type="button"
					disabled={submitting}
					onClick={() => void submit()}
					className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60 pointer-coarse:min-h-12"
				>
					{submitting && <Loader2Icon className="size-4 animate-spin" />} Submit answers
				</button>
			)}
		</div>
	);
}
