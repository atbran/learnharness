"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, ChevronRightIcon, HelpCircleIcon, Loader2Icon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import { TRACK_COLOR } from "./status";
import { useProgram, type ProgramView } from "./use-program";

/** A question on the board (src/server/learner.ts BoardQuestion). Mirrored
 *  here because components may import only the core barrel. */
export interface BoardQuestion {
	id: string;
	text: string;
	createdAt: string;
	status: "matching" | "matched" | "unmatched" | "error";
	unitId: string | null;
	lessonId: string | null;
	/** How the lesson answers it (or, unmatched, what kind of lesson would). */
	note: string;
}

/** The board's questions, newest first, refreshed when the server says the
 *  curriculum changed (a background match landing). */
export function useQuestions() {
	const [questions, setQuestions] = useState<BoardQuestion[] | null>(null);
	const load = useCallback(() => {
		void fetch("/api/program/questions", { cache: "no-store" })
			.then((r) => r.json())
			.then((b: { questions?: BoardQuestion[] }) => setQuestions(b.questions ?? []))
			.catch(() => null);
	}, []);
	useEffect(load, [load]);
	useServerEvent("curriculum-changed", load);
	return { questions, setQuestions, load };
}

interface LessonRef {
	title: string;
	courseId: string;
	courseCode: string;
	track: string;
}

function lessonRefs(program: ProgramView | undefined): Map<string, LessonRef> {
	const map = new Map<string, LessonRef>();
	for (const c of program?.courses ?? [])
		for (const u of c.units) for (const l of u.lessons) map.set(l.id, { title: l.title, courseId: c.id, courseCode: c.code, track: c.track });
	return map;
}

const newestFirst = (a: BoardQuestion, b: BoardQuestion) => b.createdAt.localeCompare(a.createdAt);

async function postQuestion(text: string): Promise<BoardQuestion> {
	const r = await fetch("/api/program/questions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
	const body = (await r.json()) as BoardQuestion & { error?: string };
	if (!r.ok) throw new Error(body.error ?? r.statusText);
	return body;
}

async function deleteQuestion(id: string): Promise<void> {
	await fetch(`/api/program/questions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * The question board: things the learner wants physics to explain, each
 * matched (in the background, by a cheap model call) to the lesson that
 * answers it. A question counts as answered once that lesson is mastered.
 */
export function QuestionBoard() {
	const { data } = useProgram(null);
	const { questions, setQuestions } = useQuestions();
	const [draft, setDraft] = useState("");
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const refs = useMemo(() => lessonRefs(data?.program), [data?.program]);
	const mastered = (q: BoardQuestion) => !!(q.status === "matched" && q.lessonId && data?.snapshot.lessons[q.lessonId]?.masteredAt);

	const sorted = [...(questions ?? [])].sort(newestFirst);
	const answered = sorted.filter(mastered);
	const waiting = sorted.filter((q) => !mastered(q));

	async function add() {
		const text = draft.trim();
		if (!text || adding) return;
		setAdding(true);
		setError(null);
		try {
			const q = await postQuestion(text);
			setQuestions((qs) => [q, ...(qs ?? []).filter((x) => x.id !== q.id)]);
			setDraft("");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setAdding(false);
		}
	}

	async function remove(q: BoardQuestion) {
		if (!window.confirm(`Delete this question?\n\n“${q.text}”`)) return;
		setQuestions((qs) => (qs ?? []).filter((x) => x.id !== q.id));
		await deleteQuestion(q.id);
	}

	/** Retry a failed match by adding the question again (and dropping the
	 *  failed copy). */
	async function retry(q: BoardQuestion) {
		try {
			const fresh = await postQuestion(q.text);
			await deleteQuestion(q.id);
			setQuestions((qs) => [fresh, ...(qs ?? []).filter((x) => x.id !== q.id && x.id !== fresh.id)]);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground pointer-coarse:py-3">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span>Questions</span>
				</div>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[900px] space-y-6 px-6 py-5 max-sm:px-4">
					<header>
						<h1 className="font-title text-4xl tracking-tight max-sm:text-3xl">Questions I want answered</h1>
						<p className="mt-1 text-sm text-muted-foreground">Write down anything you want physics to explain, and it finds the lesson that answers it.</p>
					</header>

					<form
						className="rounded-xl border border-border bg-card p-3"
						onSubmit={(e) => {
							e.preventDefault();
							void add();
						}}
					>
						<label htmlFor="question-draft" className="sr-only">
							A question you want answered
						</label>
						<textarea
							id="question-draft"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
									e.preventDefault();
									void add();
								}
							}}
							rows={2}
							maxLength={500}
							placeholder="Why is the sky blue? How does an MRI see inside you?"
							className="lh-input w-full resize-none rounded-lg border border-border bg-background p-3 text-sm"
						/>
						<div className="mt-2 flex items-center gap-3">
							<span className="text-xs text-muted-foreground max-sm:hidden">Enter to add · Shift+Enter for a new line</span>
							{error && <span className="text-xs text-destructive">{error}</span>}
							<button
								type="submit"
								disabled={!draft.trim() || adding}
								className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 pointer-coarse:min-h-11"
							>
								{adding && <Loader2Icon className="size-3.5 animate-spin" />} Add question
							</button>
						</div>
					</form>

					{questions === null ? (
						<div className="h-24 animate-pulse rounded-xl bg-card" />
					) : questions.length === 0 ? (
						<div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
							<HelpCircleIcon className="mx-auto mb-2 size-5" />
							No questions yet. Anything you&apos;ve ever wondered about — why things fall, glow, spin or stick — is a good start.
						</div>
					) : (
						<>
							<QuestionGroup title="Waiting" count={waiting.length} empty="Every question here has been answered.">
								{waiting.map((q) => (
									<QuestionRow key={q.id} q={q} lesson={q.lessonId ? refs.get(q.lessonId) : undefined} answered={false} onDelete={() => void remove(q)} onRetry={() => void retry(q)} />
								))}
							</QuestionGroup>
							<QuestionGroup title="Answered" count={answered.length} empty="Master a matched lesson and its question moves here.">
								{answered.map((q) => (
									<QuestionRow key={q.id} q={q} lesson={q.lessonId ? refs.get(q.lessonId) : undefined} answered onDelete={() => void remove(q)} onRetry={() => void retry(q)} />
								))}
							</QuestionGroup>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function QuestionGroup({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
	return (
		<section>
			<h2 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
				{title} <span className="rounded-full border border-border px-1.5 text-[10px]">{count}</span>
			</h2>
			{count === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="space-y-2">{children}</ul>}
		</section>
	);
}

function QuestionRow({ q, lesson, answered, onDelete, onRetry }: { q: BoardQuestion; lesson: LessonRef | undefined; answered: boolean; onDelete: () => void; onRetry: () => void }) {
	return (
		<li className={cn("flex items-start gap-3 rounded-xl border bg-card p-4", answered ? "border-[var(--st-mastered)]/50" : "border-border")} data-testid="board-question">
			<div className="min-w-0 flex-1">
				<p className="whitespace-pre-wrap break-words font-medium">{q.text}</p>
				<div className="mt-1.5 text-sm">
					{q.status === "matching" ? (
						<span className="flex items-center gap-1.5 text-muted-foreground">
							<Loader2Icon className="size-3.5 animate-spin" /> Finding the lesson that answers this…
						</span>
					) : q.status === "matched" && q.lessonId ? (
						<>
							<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
								<Link href={`/program/lesson/${q.lessonId}`} className="hover:underline pointer-coarse:py-2">
									{lesson ? (
										<>
											<span style={{ color: TRACK_COLOR[lesson.track] }}>{lesson.courseCode}</span> · {lesson.title}
										</>
									) : (
										"Open the lesson"
									)}{" "}
									→
								</Link>
								{answered && (
									<span className="inline-flex items-center gap-1 rounded-full border border-[var(--st-mastered)] px-2 py-0.5 text-xs text-[var(--st-mastered)]">
										<CheckCircle2Icon className="size-3" /> Answered
									</span>
								)}
							</div>
							{q.note && <p className="mt-1 text-muted-foreground">{q.note}</p>}
						</>
					) : q.status === "error" ? (
						<span className="flex flex-wrap items-center gap-2 text-muted-foreground">
							<span className="text-destructive">Couldn&apos;t match this to a lesson.</span>
							<button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent hover:text-foreground pointer-coarse:min-h-11">
								<RefreshCwIcon className="size-3" /> Try again
							</button>
						</span>
					) : (
						<p className="text-muted-foreground">{q.note || "No lesson in the program answers this yet."}</p>
					)}
				</div>
			</div>
			<button
				type="button"
				onClick={onDelete}
				aria-label="Delete question"
				title="Delete question"
				className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-11"
			>
				<Trash2Icon className="size-4" />
			</button>
		</li>
	);
}

/**
 * On a lesson page: the board questions this lesson answers — "answers your
 * question" until it is mastered, "you've now answered" after.
 */
export function LessonQuestions({ lessonId, mastered }: { lessonId: string; mastered: boolean }) {
	const { questions } = useQuestions();
	const mine = (questions ?? []).filter((q) => q.status === "matched" && q.lessonId === lessonId).sort(newestFirst);
	if (mine.length === 0) return null;
	return (
		<section
			className={cn("flex items-start gap-3 rounded-xl border p-3 text-sm", mastered ? "border-[var(--st-mastered)]/60 bg-[var(--st-mastered)]/5" : "border-[var(--st-available)]/60 bg-[var(--st-available)]/5")}
			data-testid="lesson-questions"
		>
			{mastered ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-[var(--st-mastered)]" /> : <HelpCircleIcon className="mt-0.5 size-4 shrink-0 text-[var(--st-available)]" />}
			<div className="min-w-0 flex-1">
				<span className="text-muted-foreground">{mastered ? "You've now answered: " : "This lesson answers your question: "}</span>
				{mine.map((q, i) => (
					<span key={q.id}>
						{i > 0 && <span className="text-muted-foreground"> · </span>}
						<span className="font-medium">‘{q.text}’</span>
					</span>
				))}
				<Link href="/program/questions" className="ml-2 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground hover:underline">
					Your questions →
				</Link>
			</div>
		</section>
	);
}
