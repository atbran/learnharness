"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, NotebookPenIcon, PenLineIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import type { AttemptResult, ExampleAttempt } from "@/src/core";
import { useStudyHeartbeat } from "./use-program";

interface WorkedExample {
	objective: string;
	problem: string;
	steps: string[];
	answer: string;
	check: string;
}

type ExamplesView =
	| { status: "ready"; examples: { examples: WorkedExample[]; createdAt: string }; attempts: Record<number, ExampleAttempt> }
	| { status: "writing" | "missing" }
	| { status: "error"; error: string };

/** /program/examples/<lessonId>: the lesson's worked examples, grouped by
 *  objective; each shows the problem, and the solution on a tap. */
export function WorkedExamplesPage({
	lessonId,
	lessonTitle,
	courseCode,
	objectives,
}: {
	lessonId: string;
	lessonTitle: string;
	courseCode: string;
	objectives: string[];
}) {
	useStudyHeartbeat(lessonId);
	const [view, setView] = useState<ExamplesView | null>(null);
	const load = useCallback(() => {
		void fetch(`/api/program/examples/${lessonId}`, { cache: "no-store" })
			.then((r) => r.json())
			.then(setView);
	}, [lessonId]);
	useEffect(load, [load]);
	useServerEvent("curriculum-changed", () => {
		if (view?.status !== "ready") load();
	});
	// Opening a lesson whose examples aren't built yet writes them now.
	useEffect(() => {
		if (view?.status === "missing") void write();
	}, [view?.status]);

	const write = async () => {
		const r = await fetch(`/api/program/examples/${lessonId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
		setView((await r.json()) as ExamplesView);
	};

	const examples = view?.status === "ready" ? view.examples.examples : [];
	// Grouped by objective in the lesson's order; any stray objective text goes last.
	// `index`: the example's place in the saved list, which attempts are keyed by.
	let n = 0;
	const groups = [...objectives, ...new Set(examples.map((e) => e.objective).filter((o) => !objectives.includes(o)))]
		.map((objective) => ({ objective, items: examples.flatMap((example, index) => (example.objective === objective ? [{ example, index }] : [])) }))
		.filter((g) => g.items.length > 0)
		.map((g) => ({ ...g, items: g.items.map((x) => ({ ...x, n: ++n })) }));
	const attempts = view?.status === "ready" ? view.attempts : {};

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
					<span className="whitespace-nowrap">Worked examples</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl space-y-6 px-6 py-6 max-sm:px-4" data-testid="worked-examples">
					{!view ? null : view.status === "ready" ? (
						groups.map((g) => (
							<section key={g.objective} className="space-y-3">
								<h2 className="text-xs uppercase tracking-wider text-muted-foreground">{g.objective}</h2>
								{g.items.map((x) => (
									<ExampleCard key={x.n} n={x.n} example={x.example} lessonId={lessonId} index={x.index} saved={attempts[x.index]} />
								))}
							</section>
						))
					) : view.status === "error" ? (
						<div className="rounded-xl border border-border bg-card p-4 text-sm">
							<p className="mb-3 text-destructive">{view.error}</p>
							<button type="button" onClick={() => void write()} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent pointer-coarse:min-h-11">
								Try again
							</button>
						</div>
					) : (
						<p className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
							<Loader2Icon className="size-4 animate-spin" /> Writing the worked examples from this lesson and its book pages… (a few minutes, once)
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

const RESULTS: { value: AttemptResult; label: string; tone: string }[] = [
	{ value: "got", label: "Got it", tone: "border-[var(--st-mastered)] text-[var(--st-mastered)]" },
	{ value: "partly", label: "Partly", tone: "border-[var(--st-progress)] text-[var(--st-progress)]" },
	{ value: "missed", label: "Missed it", tone: "border-destructive/60 text-destructive" },
];

function ExampleCard({ n, example, lessonId, index, saved }: { n: number; example: WorkedExample; lessonId: string; index: number; saved?: ExampleAttempt }) {
	const [open, setOpen] = useState(false);
	const [attemptOpen, setAttemptOpen] = useState(false);
	const [confidence, setConfidence] = useState<number | undefined>(saved?.confidence);
	const [result, setResult] = useState<AttemptResult | undefined>(saved?.result);
	const [stuck, setStuck] = useState(saved?.stuck ?? "");
	const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	// Each save is the whole report; edits within a second ride one save.
	const [dirty, setDirty] = useState(0);
	useEffect(() => {
		if (!dirty) return;
		const t = setTimeout(() => {
			setState("saving");
			void fetch(`/api/program/examples/${lessonId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ attempt: { example: index, confidence, result, stuck } }),
			}).then((r) => setState(r.ok ? "saved" : "error"));
		}, 1000);
		return () => clearTimeout(t);
		// Fires once per batch of edits: `dirty` changes on every edit.
	}, [dirty]);
	const edit = () => setDirty((d) => d + 1);
	const summary = [result && RESULTS.find((r) => r.value === result)!.label, confidence && `${confidence}/5`].filter(Boolean).join(" · ");
	const bar = "flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11";
	return (
		<article className="rounded-xl border border-border bg-card">
			<div className="lh-prose px-4 pb-2 pt-4">
				<p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
					<PenLineIcon className="size-3.5" /> Example {n}
				</p>
				<MessageResponse>{example.problem}</MessageResponse>
			</div>
			{open && (
				<div className="lh-prose space-y-3 border-t border-border px-4 py-3">
					<ol className="list-decimal space-y-2 pl-5">
						{example.steps.map((s, i) => (
							<li key={i}>
								<MessageResponse>{s}</MessageResponse>
							</li>
						))}
					</ol>
					<div className="rounded-lg bg-accent/50 px-3 py-2">
						<span className="text-xs uppercase tracking-wider text-muted-foreground">Answer</span>
						<MessageResponse>{example.answer}</MessageResponse>
					</div>
					<div className="text-sm text-muted-foreground">
						<span className="text-xs uppercase tracking-wider">Sanity check</span>
						<MessageResponse>{example.check}</MessageResponse>
					</div>
				</div>
			)}
			{attemptOpen && (
				<div className="space-y-3 border-t border-border px-4 py-3 text-sm" data-testid="example-attempt">
					<label className="flex flex-wrap items-center gap-3">
						<span className="text-xs text-muted-foreground">Confidence</span>
						<input
							type="range"
							min={1}
							max={5}
							step={1}
							value={confidence ?? 3}
							onChange={(e) => {
								setConfidence(Number(e.target.value));
								edit();
							}}
							className={cn("w-40 accent-[var(--xp)]", confidence === undefined && "opacity-50")}
							aria-valuetext={confidence ? `${confidence} of 5` : "not set"}
						/>
						<span className="w-8 text-xs tabular-nums text-muted-foreground">{confidence ? `${confidence}/5` : "—"}</span>
					</label>
					<div className="flex flex-wrap gap-2">
						{RESULTS.map((r) => (
							<button
								key={r.value}
								type="button"
								aria-pressed={result === r.value}
								onClick={() => {
									setResult(result === r.value ? undefined : r.value);
									edit();
								}}
								className={cn("rounded-lg border px-3 py-1 text-xs pointer-coarse:min-h-11", result === r.value ? r.tone : "border-border text-muted-foreground hover:bg-accent")}
							>
								{r.label}
							</button>
						))}
					</div>
					<textarea
						value={stuck}
						onChange={(e) => {
							setStuck(e.target.value);
							edit();
						}}
						rows={2}
						placeholder="Where I got stuck (optional): your tutor sees this"
						className="lh-input w-full rounded-lg border border-border bg-background p-2 text-sm"
					/>
					<p className="text-[11px] text-muted-foreground">
						{state === "saving" ? "Saving…" : state === "saved" ? "Saved." : state === "error" ? "Couldn't save; edit again to retry." : "Saves as you go."}
					</p>
				</div>
			)}
			<div className="flex divide-x divide-border border-t border-border">
				<button type="button" onClick={() => setAttemptOpen((o) => !o)} aria-expanded={attemptOpen} className={bar}>
					<NotebookPenIcon className="size-3.5" />
					My attempt{summary ? ` · ${summary}` : ""}
				</button>
				<button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={bar}>
					{open ? "Hide the solution" : "Show the solution"}
					<ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
				</button>
			</div>
		</article>
	);
}
