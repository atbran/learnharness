"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, PenLineIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { useStudyHeartbeat } from "./use-program";

interface WorkedExample {
	objective: string;
	problem: string;
	steps: string[];
	answer: string;
	check: string;
}

type ExamplesView =
	| { status: "ready"; examples: { examples: WorkedExample[]; createdAt: string } }
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
	let n = 0;
	const groups = [...objectives, ...new Set(examples.map((e) => e.objective).filter((o) => !objectives.includes(o)))]
		.map((objective) => ({ objective, items: examples.filter((e) => e.objective === objective) }))
		.filter((g) => g.items.length > 0)
		.map((g) => ({ ...g, items: g.items.map((example) => ({ example, n: ++n })) }));

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
									<ExampleCard key={x.n} n={x.n} example={x.example} />
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

function ExampleCard({ n, example }: { n: number; example: WorkedExample }) {
	const [open, setOpen] = useState(false);
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
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11"
			>
				{open ? "Hide the solution" : "Show the solution"}
				<ChevronDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} />
			</button>
		</article>
	);
}
