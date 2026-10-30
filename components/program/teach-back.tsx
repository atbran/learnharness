"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, ChevronDownIcon, GraduationCapIcon, Loader2Icon, MessageSquareTextIcon, PencilLineIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { insertMathIntoField, MathButton } from "@/components/math-input";
import { cn } from "@/lib/utils";

/** A teach-back explanation (src/server/learner.ts NotebookEntry). Mirrored
 *  here because components may import only the core barrel. */
export interface NotebookEntry {
	id: string;
	lessonId: string;
	text: string;
	at: string;
	feedback: string | null;
	accurate: boolean | null;
}

export const entryDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The notebook's entries (newest first). */
export function useNotebook() {
	const [entries, setEntries] = useState<NotebookEntry[] | null>(null);
	const load = useCallback(() => {
		void fetch("/api/program/notebook", { cache: "no-store" })
			.then((r) => r.json())
			.then((b: { entries?: NotebookEntry[] }) => setEntries([...(b.entries ?? [])].sort((a, z) => z.at.localeCompare(a.at))))
			.catch(() => null);
	}, []);
	useEffect(load, [load]);
	return { entries, setEntries, load };
}

/** The feedback line: an accurate ✓ or a "check this" badge, then the text. */
export function Feedback({ entry, className }: { entry: NotebookEntry; className?: string }) {
	if (!entry.feedback) return null;
	return (
		<div className={cn("flex flex-col items-start gap-1.5 text-sm text-muted-foreground [--lh-prose-size:14px]", className)}>
			{entry.accurate === false ? (
				<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--st-progress)] px-2 py-0.5 text-xs text-[var(--st-progress)]">
					<AlertTriangleIcon className="size-3" /> Check this
				</span>
			) : entry.accurate ? (
				<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--st-mastered)] px-2 py-0.5 text-xs text-[var(--st-mastered)]">
					<CheckCircle2Icon className="size-3" /> Accurate
				</span>
			) : null}
			<div className="w-full min-w-0">
				<MessageResponse className="h-auto!">{entry.feedback}</MessageResponse>
			</div>
		</div>
	);
}

/**
 * After mastery: teach the lesson back. Write it (an explanation in your own
 * words, saved to the notebook with brief feedback) or teach the tutor (a
 * session where the tutor plays the student).
 */
export function TeachBack({ lessonId, lessonTitle, courseCode }: { lessonId: string; lessonTitle: string; courseCode: string }) {
	const router = useRouter();
	const { entries, setEntries } = useNotebook();
	const [text, setText] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [latest, setLatest] = useState<NotebookEntry | null>(null);
	const [starting, setStarting] = useState(false);
	const field = useRef<HTMLTextAreaElement | null>(null);

	const earlier = (entries ?? []).filter((e) => e.lessonId === lessonId && e.id !== latest?.id);

	async function submit() {
		const clean = text.trim();
		if (!clean || saving) return;
		setSaving(true);
		setError(null);
		try {
			const r = await fetch("/api/program/notebook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessonId, text: clean }) });
			const body = (await r.json()) as NotebookEntry & { error?: string };
			if (!r.ok) throw new Error(body.error ?? r.statusText);
			// The previous result joins the earlier list.
			setEntries((es) => [body, ...(es ?? []).filter((e) => e.id !== body.id)]);
			setLatest(body);
			setText("");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	}

	async function teachTutor() {
		setStarting(true);
		try {
			const res = await fetch("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: `Teach back · ${courseCode} · ${lessonTitle}`, lessonId, kind: "teachback" }),
			});
			const body = (await res.json()) as { id?: string };
			if (!res.ok || !body.id) throw new Error("could not create the session");
			router.push(`/chat/${body.id}?prompt=${encodeURIComponent("I'm ready to teach this lesson back.")}`);
		} catch {
			setStarting(false);
		}
	}

	return (
		<section className="rounded-xl border border-border bg-card p-4" data-testid="teach-back">
			<h2 className="flex items-center gap-2 font-semibold">
				<MessageSquareTextIcon className="size-4" /> Teach it back
			</h2>
			<p className="mt-1 text-sm text-muted-foreground">You&apos;ve mastered this lesson. Explaining it in your own words is the surest way to keep it.</p>

			<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-medium">
						<PencilLineIcon className="size-4" /> Write it
					</div>
					<textarea
						ref={field}
						value={text}
						disabled={saving}
						onChange={(e) => setText(e.target.value)}
						rows={5}
						maxLength={8000}
						placeholder="Explain this lesson as if to a friend who missed it: the idea, why it works, and an example (math like $F = ma$ is fine)."
						className="lh-input mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm disabled:opacity-60"
					/>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<MathButton target={() => field.current} allowDisplay disabled={saving} onInsert={(latex, display) => insertMathIntoField(field.current, text, setText, latex, display)} />
						{error && <span className="text-xs text-destructive">{error}</span>}
						<button
							type="button"
							onClick={() => void submit()}
							disabled={!text.trim() || saving}
							className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 pointer-coarse:min-h-11"
						>
							{saving ? (
								<>
									<Loader2Icon className="size-3.5 animate-spin" /> Reading it…
								</>
							) : (
								"Save to notebook"
							)}
						</button>
					</div>

					{latest && (
						<div className="mt-3 rounded-lg bg-accent/50 p-3" data-testid="teach-back-result">
							{latest.feedback ? <Feedback entry={latest} /> : <p className="text-sm text-muted-foreground">Saved to your notebook. Feedback couldn&apos;t be written this time.</p>}
							<Link href="/program/notebook" className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
								Open your notebook →
							</Link>
						</div>
					)}

					{earlier.length > 0 && (
						<details className="group mt-3 rounded-lg border border-border">
							<summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
								<ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" />
								{latest ? "Earlier" : "Your earlier"} explanation{earlier.length === 1 ? "" : "s"} ({earlier.length})
							</summary>
							<ul className="space-y-3 border-t border-border px-3 py-3">
								{earlier.map((e) => (
									<li key={e.id} className="space-y-1.5">
										<div className="text-xs text-muted-foreground">{entryDate(e.at)}</div>
										<div className="text-sm">
											<MessageResponse className="h-auto!">{e.text}</MessageResponse>
										</div>
										<Feedback entry={e} />
									</li>
								))}
							</ul>
						</details>
					)}
				</div>

				<div className="flex flex-col rounded-lg border border-border p-3 lg:self-start">
					<div className="flex items-center gap-2 text-sm font-medium">
						<GraduationCapIcon className="size-4" /> Teach the tutor
					</div>
					<p className="mt-1 flex-1 text-sm text-muted-foreground">The tutor plays a confused student. Teach it the lesson and answer its questions.</p>
					<button
						type="button"
						onClick={() => void teachTutor()}
						disabled={starting}
						className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60 pointer-coarse:min-h-11"
					>
						{starting ? "Starting…" : "Start teaching"}
					</button>
				</div>
			</div>
		</section>
	);
}
