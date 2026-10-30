"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2Icon, PauseIcon, PlayIcon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import { useServerEvent } from "@/components/server-events";
import { pct } from "./status";

interface PrebuildStatus {
	enabled: boolean;
	courses: string[];
	total: number;
	built: number;
	failed: number;
	building: { lessonId: string; i: number; title: string }[];
	pausedUntil: string | null;
	lastError: string | null;
	active: boolean;
}

/** Program home: the background build of every lesson demo — progress,
 *  what's building now, and start/pause. */
export function DemoPrebuildCard() {
	const [s, setS] = useState<PrebuildStatus | null>(null);
	const [busy, setBusy] = useState(false);
	// Build events arrive in bursts; one refetch per burst is plenty.
	const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
	const refresh = useCallback(() => {
		if (pending.current) return;
		pending.current = setTimeout(() => {
			pending.current = null;
			void fetch("/api/program/demos/prebuild", { cache: "no-store" })
				.then((r) => r.json())
				.then(setS);
		}, 1000);
	}, []);
	useEffect(() => {
		void fetch("/api/program/demos/prebuild", { cache: "no-store" })
			.then((r) => r.json())
			.then(setS);
	}, []);
	useServerEvent("curriculum-changed", refresh);

	const set = async (enabled: boolean, retryFailed = false) => {
		setBusy(true);
		try {
			const r = await fetch("/api/program/demos/prebuild", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled, retryFailed }),
			});
			setS((await r.json()) as PrebuildStatus);
		} finally {
			setBusy(false);
		}
	};

	if (!s || s.total === 0) return null;
	const done = s.built >= s.total;
	const paused = s.pausedUntil ? new Date(s.pausedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

	return (
		<section className="rounded-xl border border-border bg-card p-4" data-testid="demo-prebuild">
			<div className="flex flex-wrap items-center gap-3">
				<SparklesIcon className="size-4 text-[var(--xp)]" />
				<h2 className="text-sm font-semibold">Interactive demos{s.courses.length ? ` · ${s.courses.join(", ")}` : ""}</h2>
				<span className="text-xs text-muted-foreground">
					{s.built}/{s.total} built ({pct(s.built / s.total)}){s.failed > 0 ? ` · ${s.failed} couldn't be built` : ""}
				</span>
				<div className="ml-auto flex items-center gap-2">
					{s.failed > 0 && (
						<button
							type="button"
							disabled={busy}
							onClick={() => void set(true, true)}
							className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent pointer-coarse:min-h-11"
						>
							<RotateCcwIcon className="size-3.5" /> Retry failed
						</button>
					)}
					{!done && (
						<button
							type="button"
							disabled={busy}
							onClick={() => void set(!s.enabled)}
							className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent pointer-coarse:min-h-11"
						>
							{s.enabled ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
							{s.enabled ? "Pause" : s.built > 0 ? "Resume building" : "Build all demos"}
						</button>
					)}
				</div>
			</div>
			<div className="mt-3 h-1.5 overflow-hidden rounded bg-accent">
				<div className="h-full bg-[var(--xp)] transition-[width]" style={{ width: pct(s.built / s.total) }} />
			</div>
			<div className="mt-2 space-y-1 text-xs text-muted-foreground">
				{done && <p>Every demo is built.</p>}
				{!done && !s.enabled && <p>Paused. Demos still build one at a time when you open them.</p>}
				{s.enabled && paused && <p>Hit the usage limit; resuming around {paused}.</p>}
				{s.enabled && !paused && s.building.length > 0 && (
					<p className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<Loader2Icon className="size-3 animate-spin" />
						{s.building.map((b) => (
							<Link key={`${b.lessonId}-${b.i}`} href={`/program/demo/${b.lessonId}/${b.i}`} className="hover:text-foreground">
								{b.title}
							</Link>
						))}
					</p>
				)}
				{s.enabled && !paused && !s.active && !done && <p>Waiting for the server to pick it up.</p>}
				<p>Runs while LearnHarness is open on the PC, two at a time, in course order.</p>
			</div>
		</section>
	);
}
