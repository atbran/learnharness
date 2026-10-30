"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CameraIcon, ChevronRightIcon, ClockIcon, GraduationCapIcon, Loader2Icon, LockIcon, PencilLineIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";
import type { Assessment } from "@/src/core";
import { ProgressRing } from "./charts";
import { EquationSheet, QuestionEquations, type EquationGroup } from "./equations";
import { InkPad } from "./ink-pad";
import { pct } from "./status";
import { useStudyHeartbeat } from "./use-program";

type View = Assessment & { task?: { status: string; error?: string } | null; sheet?: EquationGroup[] };

const KIND_LABEL: Record<Assessment["kind"], string> = { pset: "Problem set", midterm: "Midterm", final: "Final exam", placement: "Placement test" };

export function AssessmentPage({ initial, course }: { initial: View; course: { id: string; code: string; title: string } }) {
	const [a, setA] = useState<View>(initial);
	const router = useRouter();
	useStudyHeartbeat();
	const refresh = useCallback(() => {
		void fetch(`/api/program/assessments/${initial.id}`)
			.then((r) => r.json())
			.then((v: View) => setA(v));
	}, [initial.id]);
	useServerEvent("curriculum-changed", refresh);
	const act = async (action: string, extra: Record<string, unknown> = {}) => {
		const r = await fetch(`/api/program/assessments/${a.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
		if (r.ok) setA((await r.json()) as View);
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<TopBar>
				<div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
					<Link href="/program" className="hover:text-foreground">
						Program
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<Link href={`/program/course/${course.id}`} className="hover:text-foreground">
						{course.code}
					</Link>
					<ChevronRightIcon className="size-3.5" />
					<span className="truncate">{a.title}</span>
				</div>
				{a.status === "in-progress" && a.minutes && a.startedAt && (
					<Countdown startedAt={a.startedAt} minutes={a.minutes} onExpire={() => void act("submit")} />
				)}
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
					<header>
						<div className="text-xs uppercase tracking-wider text-muted-foreground">
							{KIND_LABEL[a.kind]} · {course.title}
						</div>
						<h1 className="font-title mt-1 text-4xl tracking-tight">{a.title}</h1>
						<div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
							{a.minutes ? (
								<span className="flex items-center gap-1">
									<ClockIcon className="size-3.5" /> {a.minutes} min
								</span>
							) : (
								<span>untimed · open book</span>
							)}
							{a.closedBook && (
								<span className="flex items-center gap-1">
									<LockIcon className="size-3.5" /> closed book
								</span>
							)}
							<span>pass {pct(a.passMark)}</span>
							{a.problems.length > 0 && <span>{a.problems.length} problems · {a.problems.reduce((s, p) => s + p.points, 0)} pts</span>}
						</div>
					</header>

					{a.status === "generating" && (
						<div className="rounded-xl border border-border bg-card p-8 text-center">
							<Loader2Icon className="mx-auto size-7 animate-spin text-muted-foreground" />
							<p className="mt-3 text-sm text-muted-foreground">
								Writing your {KIND_LABEL[a.kind].toLowerCase()} — pulling exercises from your textbooks where they're on the shelf. This takes a minute or two and happens once.
							</p>
						</div>
					)}
					{a.status === "error" && (
						<div className="rounded-xl border border-destructive/60 bg-card p-6 text-sm">
							<p className="text-destructive">{a.error ?? "Generation failed."}</p>
							<button type="button" onClick={() => void act("retry")} className="mt-3 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 hover:bg-accent">
								<RefreshCwIcon className="size-3.5" /> Try again
							</button>
						</div>
					)}
					{a.status === "ready" && (
						<div className="rounded-xl border border-border bg-card p-6">
							<p className="text-sm text-muted-foreground">
								{a.minutes
									? `Once you start, a ${a.minutes}-minute timer runs and the exam submits itself at zero. ${a.closedBook ? "Closed book: no notes, lessons, or tutor." : ""}`
									: "Work on paper or type your answers. Photograph handwritten work per problem; the grader reads both."}
							</p>
							<button type="button" onClick={() => void act("start")} className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">
								Start {a.minutes ? "the clock" : ""}
							</button>
						</div>
					)}

					{a.status === "graded" && a.grade && (
						<div className="flex flex-wrap items-center gap-5 rounded-xl border bg-card p-5" style={{ borderColor: a.grade.score >= a.passMark ? "var(--st-mastered)" : "var(--st-progress)" }}>
							<ProgressRing value={a.grade.score} size={86} stroke={8} color={a.grade.score >= a.passMark ? "var(--st-mastered)" : "var(--st-progress)"}>
								<span className="text-base">{pct(a.grade.score)}</span>
							</ProgressRing>
							<div className="min-w-0 flex-1">
								<div className="font-semibold">{a.grade.score >= a.passMark ? "Passed" : "Not yet passing"}</div>
								<div className="lh-prose mt-1 text-sm text-muted-foreground">
									<MessageResponse>{a.grade.summary}</MessageResponse>
								</div>
								{a.grade.testedOut && a.grade.testedOut.length > 0 && (
									<div className="mt-1 text-sm text-[var(--st-mastered)]">Tested out of {a.grade.testedOut.length} lessons — they're marked mastered on your map.</div>
								)}
							</div>
							<button
								type="button"
								onClick={() => router.push(a.examId ? `/program/assessment/new?exam=${a.examId}&fresh=1` : `/program/assessment/new?unit=${a.unitIds[0]}&fresh=1`)}
								className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
							>
								New variant
							</button>
						</div>
					)}
					{a.status === "grading" && (
						<div className="rounded-xl border border-border bg-card p-6 text-center">
							<Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />
							<p className="mt-2 text-sm text-muted-foreground">Grading your work against each problem's rubric…</p>
						</div>
					)}
					{a.error && a.status === "in-progress" && <div className="text-sm text-destructive">Grading failed: {a.error} — submit again.</div>}

					{(a.status === "in-progress" || a.status === "grading" || a.status === "graded") && <EquationSheet groups={a.sheet ?? []} />}
					{(a.status === "in-progress" || a.status === "grading" || a.status === "graded") &&
						a.problems.map((p, i) => <ProblemCard key={p.id} a={a} index={i} onChanged={refresh} />)}

					{a.status === "in-progress" && (
						<button
							type="button"
							onClick={() => {
								if (window.confirm("Submit for grading? You can't change answers afterwards.")) void act("submit");
							}}
							className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
						>
							Submit for grading
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function ProblemCard({ a, index, onChanged }: { a: View; index: number; onChanged: () => void }) {
	const p = a.problems[index]!;
	const answer = a.answers[p.id] ?? { text: "", images: [] };
	const grade = a.grade?.perProblem.find((g) => g.problemId === p.id);
	const editable = a.status === "in-progress";
	const [text, setText] = useState(answer.text);
	const [uploading, setUploading] = useState(false);
	const [showSolution, setShowSolution] = useState(false);
	const [inking, setInking] = useState(false);
	const file = useRef<HTMLInputElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const router = useRouter();

	const saveText = (t: string) => {
		setText(t);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			void fetch(`/api/program/assessments/${a.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "answer", problemId: p.id, text: t }) });
		}, 600);
	};

	async function discuss() {
		const lessonId = p.lessonIds[0];
		const res = await fetch("/api/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: `Discuss: ${a.title} ${p.id}`, lessonId }),
		});
		const body = (await res.json()) as { id?: string };
		if (!body.id) return;
		const opener = [
			"Help me understand this problem from my graded work.",
			`Problem:\n${p.prompt}`,
			`My answer: ${answer.text || "(handwritten — see feedback)"}`,
			grade ? `Grader feedback (${grade.points}/${grade.max}): ${grade.feedback}${grade.firstError ? ` First error: ${grade.firstError}` : ""}` : "",
		]
			.filter(Boolean)
			.join("\n\n");
		router.push(`/chat/${body.id}?prompt=${encodeURIComponent(opener)}`);
	}

	return (
		<section className={cn("rounded-xl border bg-card p-5", grade ? (grade.points >= grade.max * 0.7 ? "border-[var(--st-mastered)]/70" : "border-[var(--st-progress)]/70") : "border-border")}>
			<div className="mb-2 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
				<span>Problem {index + 1}</span>
				<span>{p.points} pts</span>
				{p.source && <span className="normal-case tracking-normal">· {p.source}</span>}
				{grade && (
					<span className="ml-auto text-sm normal-case tracking-normal" style={{ color: grade.points >= grade.max * 0.7 ? "var(--st-mastered)" : "var(--st-progress)" }}>
						{grade.points}/{grade.max}
					</span>
				)}
			</div>
			<div className="lh-prose">
				<MessageResponse>{p.prompt}</MessageResponse>
			</div>
			<QuestionEquations equations={p.equations} />

			{editable ? (
				<textarea
					value={text}
					onChange={(e) => saveText(e.target.value)}
					rows={5}
					placeholder="Type your solution (math like $\nabla \cdot E = \rho/\epsilon_0$ works), and/or attach photos of your handwritten work below."
					className="lh-input mt-4 w-full rounded-lg border border-border bg-background p-3 text-sm"
				/>
			) : (
				answer.text && (
					<div className="lh-prose mt-4 rounded-lg border border-border bg-background p-3 text-sm">
						<MessageResponse>{answer.text}</MessageResponse>
					</div>
				)
			)}

			<div className="mt-3 flex flex-wrap items-center gap-2">
				{answer.images.map((f) => (
					<div key={f} className="group relative">
						<a href={`/api/program/uploads/${f}`} target="_blank" rel="noreferrer">
							{/* eslint-disable-next-line @next/next/no-img-element -- local upload thumbnail */}
							<img src={`/api/program/uploads/${f}`} alt="handwritten work" className="h-24 w-auto rounded-lg border border-border object-cover" />
						</a>
						{editable && (
							<button
								type="button"
								aria-label="Remove photo"
								onClick={async () => {
									await fetch(`/api/program/assessments/${a.id}/uploads?problem=${p.id}&file=${encodeURIComponent(f)}`, { method: "DELETE" });
									onChanged();
								}}
								className="absolute right-1 top-1 hidden rounded bg-black/70 p-1 text-white group-hover:block [@media(hover:none)]:block"
							>
								<TrashIcon className="size-3.5" />
							</button>
						)}
					</div>
				))}
				{editable && (
					<>
						<button
							type="button"
							onClick={() => file.current?.click()}
							disabled={uploading}
							className="flex h-24 items-center gap-1.5 rounded-lg border border-dashed border-border px-4 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							{uploading ? <Loader2Icon className="size-4 animate-spin" /> : <CameraIcon className="size-4" />} Add photo
						</button>
						<button
							type="button"
							onClick={() => setInking(true)}
							className="flex h-24 items-center gap-1.5 rounded-lg border border-dashed border-border px-4 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<PencilLineIcon className="size-4" /> Write with Pencil
						</button>
						{inking && (
							<InkPad assessmentId={a.id} problemId={p.id} label={`Problem ${index + 1}`} images={answer.images} onClose={() => setInking(false)} onUploaded={onChanged} />
						)}
						<input
							ref={file}
							type="file"
							accept="image/*"
							capture="environment"
							multiple
							className="hidden"
							onChange={async (e) => {
								const files = [...(e.target.files ?? [])];
								e.target.value = "";
								setUploading(true);
								for (const f of files)
									await fetch(`/api/program/assessments/${a.id}/uploads?problem=${p.id}`, { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f });
								setUploading(false);
								onChanged();
							}}
						/>
					</>
				)}
			</div>

			{grade && (
				<div className="mt-4 space-y-2">
					<div className="lh-prose rounded-lg bg-accent/50 p-3 text-sm">
						<MessageResponse>{grade.feedback}</MessageResponse>
						{grade.firstError && (
							<p className="mt-2 text-[var(--st-progress)]">
								<strong>First misstep:</strong> {grade.firstError}
							</p>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						<button type="button" onClick={() => setShowSolution((v) => !v)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">
							{showSolution ? "Hide" : "Show"} worked solution
						</button>
						<button type="button" onClick={() => void discuss()} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">
							<GraduationCapIcon className="size-3.5" /> Discuss with tutor
						</button>
					</div>
					{showSolution && (
						<div className="lh-prose rounded-lg border border-border p-4 text-sm">
							<div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Rubric</div>
							<ul className="mb-3 list-disc pl-5">
								{p.rubric.map((r, i) => (
									<li key={i}>{r}</li>
								))}
							</ul>
							<MessageResponse>{p.solution}</MessageResponse>
						</div>
					)}
				</div>
			)}
		</section>
	);
}

function Countdown({ startedAt, minutes, onExpire }: { startedAt: string; minutes: number; onExpire: () => void }) {
	const end = Date.parse(startedAt) + minutes * 60_000;
	const [now, setNow] = useState(Date.now());
	const fired = useRef(false);
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);
	const left = Math.max(0, end - now);
	useEffect(() => {
		if (left === 0 && !fired.current) {
			fired.current = true;
			onExpire();
		}
	}, [left, onExpire]);
	const m = Math.floor(left / 60_000);
	const s = Math.floor((left % 60_000) / 1000);
	return (
		<div className={cn("ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1 font-mono text-sm", left < 5 * 60_000 ? "bg-[var(--st-progress)]/20 text-[var(--st-progress)]" : "bg-accent")}>
			<ClockIcon className="size-4" /> {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
		</div>
	);
}
