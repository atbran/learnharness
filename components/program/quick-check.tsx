"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, ChevronRightIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { latexToNumberText } from "@/lib/math-insert";
import { insertMathIntoField, MathButton } from "@/components/math-input";
import { ProgressRing } from "./charts";
import { EquationSheet, QuestionEquations } from "./equations";
import { pct } from "./status";
import { useStudyHeartbeat } from "./use-program";

export type PublicQ = ({ kind: "mc"; prompt: string; options: string[] } | { kind: "numeric"; prompt: string; unit?: string } | { kind: "short"; prompt: string }) & { equations?: string[] };
type CheckState = { status: "ready"; questions: PublicQ[]; sheet?: string[] } | { status: "generating" | "missing" | "error"; error?: string };
interface Result {
	score: number;
	perQuestion: { correct: boolean; credit: number; feedback: string }[];
}

/** One lesson's quick check (or a spaced-review subset of it). Graded on
 *  the server; ≥ 80% masters the lesson. */
export function QuickCheckPage({
	lessonId,
	lessonTitle,
	courseCode,
	review,
	only,
	thenNow,
}: {
	lessonId: string;
	lessonTitle: string;
	courseCode: string;
	review?: boolean;
	only?: number[];
	/** "Then and now": `only` is one long-ago missed question, tried again. */
	thenNow?: boolean;
}) {
	useStudyHeartbeat(lessonId);
	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0" />
					<Link href={`/program/lesson/${lessonId}`} className="truncate hover:text-foreground">
						{courseCode} · {lessonTitle}
					</Link>
					<ChevronRightIcon className="size-3.5 shrink-0" />
					<span className="whitespace-nowrap">{thenNow ? "Then and now" : review ? "Review" : "Quick check"}</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl px-6 py-6 max-sm:px-4">
					<QuickCheck lessonId={lessonId} review={review} only={only} thenNow={thenNow} />
				</div>
			</div>
		</div>
	);
}

export function QuickCheck({
	lessonId,
	review,
	only,
	missedRetake,
	thenNow,
	onDone,
}: {
	lessonId: string;
	review?: boolean;
	/** Show exactly these question indexes (short ones included). */
	only?: number[];
	/** Retaking just the questions missed last time (sent with the grade). */
	missedRetake?: boolean;
	/** "Then and now": one question missed weeks ago (recorded as then_now, not a quiz score). */
	thenNow?: boolean;
	onDone?: (score: number) => void;
}) {
	const [state, setState] = useState<CheckState | null>(null);
	const [answers, setAnswers] = useState<string[]>([]);
	const [result, setResult] = useState<Result | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const setAnswer = (i: number) => (v: string) => setAnswers((a) => Object.assign([...a], { [i]: v }));

	const load = useCallback(() => {
		void fetch(`/api/program/checks/${lessonId}`)
			.then((r) => r.json())
			.then((s: CheckState) => setState(s));
	}, [lessonId]);
	useEffect(load, [load]);
	useServerEvent("curriculum-changed", () => {
		if (state?.status === "generating") load();
	});

	if (!state) return <Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />;
	if (state.status !== "ready")
		return (
			<div className="rounded-xl border border-border bg-card p-6 text-center">
				{state.status === "generating" ? (
					<>
						<Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />
						<p className="mt-3 text-sm text-muted-foreground">Writing your quick check from the lesson objectives… (about half a minute, once — it's saved for reviews)</p>
					</>
				) : (
					<>
						{state.error && <p className="mb-3 text-sm text-destructive">{state.error}</p>}
						<p className="text-sm text-muted-foreground">Five questions on this lesson's objectives. Score 80% or higher to master it.</p>
						<button
							type="button"
							onClick={async () => {
								const r = await fetch(`/api/program/checks/${lessonId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generate: true }) });
								setState((await r.json()) as CheckState);
							}}
							className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground pointer-coarse:min-h-11"
						>
							Create quick check
						</button>
					</>
				)}
			</div>
		);

	// Reviews use only the auto-graded questions: free to retake, no model call.
	const indexes = only ?? state.questions.flatMap((q, i) => (review && q.kind === "short" ? [] : [i]));
	const qs = indexes.map((i) => state.questions[i]).filter((q): q is PublicQ => !!q);
	return (
		<div className="space-y-4">
			<EquationSheet groups={[{ title: "This lesson", equations: state.sheet ?? [] }]} />
			{result && (
				<div className="flex flex-wrap items-center gap-4 rounded-xl border p-4" style={{ borderColor: result.score >= 0.8 ? "var(--st-mastered)" : "var(--st-progress)" }}>
					<ProgressRing value={result.score} size={64} color={result.score >= 0.8 ? "var(--st-mastered)" : "var(--st-progress)"}>
						{pct(result.score)}
					</ProgressRing>
					<div className="min-w-48 flex-1 text-sm">
						{thenNow
							? result.score >= 0.8
								? "Then: missed · Now: ✓ — you've got this."
								: "Not yet — it's back in your missed questions."
							: review
							? "Review logged — the next one is scheduled further out when you do well."
							: result.score >= 0.8
								? "Mastered! It joins your spaced-review schedule."
								: "Not mastered yet — read the feedback, revisit the lesson, and try again."}
					</div>
					<Link
						href={thenNow ? "/program" : `/program/lesson/${lessonId}`}
						className="flex items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent pointer-coarse:min-h-11"
					>
						{thenNow ? "Back to program" : "Back to lesson"}
					</Link>
				</div>
			)}
			{qs.map((q, i) => (
				<CheckQuestionField key={i} q={q} index={i} value={answers[i] ?? ""} onChange={setAnswer(i)} locked={!!result} result={result?.perQuestion[i]} />
			))}
			{error && <div className="text-sm text-destructive">{error}</div>}
			{!result && (
				<button
					type="button"
					disabled={submitting}
					onClick={async () => {
						setSubmitting(true);
						setError(null);
						const r = await fetch(`/api/program/checks/${lessonId}`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ responses: qs.map((_, i) => answers[i] ?? ""), review, only: indexes, ...(missedRetake ? { missedRetake: true } : {}), ...(thenNow ? { thenNow: true } : {}) }),
						});
						const body = (await r.json()) as Result & { error?: string };
						setSubmitting(false);
						if (!r.ok) return setError(body.error ?? "grading failed");
						setResult(body);
						onDone?.(body.score);
					}}
					className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60 pointer-coarse:min-h-12"
				>
					{submitting && <Loader2Icon className="size-4 animate-spin" />} Submit answers
				</button>
			)}
		</div>
	);
}

/** One auto- or model-graded question: prompt, the equations it needs, the
 *  answer input (choices, a number with the MathLive button, or a short
 *  answer) and, once graded, its verdict and feedback. Shared by the quick
 *  check and the unit test-out diagnostic. */
export function CheckQuestionField({
	q,
	index,
	value,
	onChange,
	locked,
	result,
}: {
	q: PublicQ;
	/** Position in the form: numbers the card and names its radio group. */
	index: number;
	value: string;
	onChange: (v: string) => void;
	/** Graded or submitting: inputs disabled, math buttons hidden. */
	locked: boolean;
	result?: { correct: boolean; feedback: string };
}) {
	const field = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
	const r = result;
	const i = index;
	return (
		<div className={cn("rounded-xl border bg-card p-4", r ? (r.correct ? "border-[var(--st-mastered)]" : "border-[var(--st-progress)]") : "border-border")}>
			<div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
				Question {i + 1} · {q.kind === "mc" ? "choose one" : q.kind === "numeric" ? "number" : "short answer"}
				{r && (r.correct ? <CheckCircle2Icon className="size-4 text-[var(--st-mastered)]" /> : <XCircleIcon className="size-4 text-[var(--st-progress)]" />)}
			</div>
			<div className="lh-prose">
				<MessageResponse>{q.prompt}</MessageResponse>
			</div>
			<QuestionEquations equations={q.equations} />
			{q.kind === "mc" && (
				<div className="mt-3 space-y-2">
					{q.options.map((o, oi) => (
						<label key={oi} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 hover:bg-accent", value === String(oi) ? "border-foreground" : "border-border")}>
							<input type="radio" name={`q${i}`} disabled={locked} checked={value === String(oi)} onChange={() => onChange(String(oi))} className="mt-1 pointer-coarse:size-5" />
							<div className="lh-prose min-w-0 flex-1 text-[15px]">
								<MessageResponse>{o}</MessageResponse>
							</div>
						</label>
					))}
				</div>
			)}
			{q.kind === "numeric" && (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<input
						ref={(el) => {
							field.current = el;
						}}
						value={value}
						disabled={locked}
						onChange={(e) => onChange(e.target.value)}
						placeholder="e.g. 3.2e-5"
						className="lh-input w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-sm pointer-coarse:min-h-11"
					/>
					{q.unit && <span className="text-sm text-muted-foreground">{q.unit}</span>}
					{/* A number typed as math (3.2×10⁻⁵, ¼) goes in as plain
					    text the server's parseNumber reads, replacing the box. */}
					{!locked && (
						<MathButton
							target={() => field.current}
							validate={(latex) => (latexToNumberText(latex) === null ? "Enter a single number, e.g. 3.2×10⁻⁵ or ¼ — no expressions." : null)}
							hint="One number — scientific notation and simple fractions are converted for you."
							onInsert={(latex) => onChange(latexToNumberText(latex) ?? "")}
						/>
					)}
				</div>
			)}
			{q.kind === "short" && (
				<>
					<textarea
						ref={(el) => {
							field.current = el;
						}}
						value={value}
						disabled={locked}
						onChange={(e) => onChange(e.target.value)}
						rows={4}
						placeholder="Explain in a few sentences (you can write math like $E = mc^2$)."
						className="lh-input mt-3 w-full rounded-lg border border-border bg-background p-3 text-sm"
					/>
					{!locked && (
						<div className="mt-2 flex">
							<MathButton target={() => field.current} onInsert={(latex) => insertMathIntoField(field.current, value, onChange, latex)} />
						</div>
					)}
				</>
			)}
			{r && (
				<div className="lh-prose mt-3 rounded-lg bg-accent/50 p-3 text-sm">
					<MessageResponse>{r.feedback}</MessageResponse>
				</div>
			)}
		</div>
	);
}
