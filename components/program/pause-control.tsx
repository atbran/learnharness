"use client";

import { useState } from "react";
import { PauseCircleIcon } from "lucide-react";
import { addDays, type Pause } from "@/src/core";
import { cn } from "@/lib/utils";
import { fmtDay } from "./status";

const LENGTHS = [
	{ id: "3", label: "3 days", days: 3 },
	{ id: "7", label: "1 week", days: 7 },
	{ id: "14", label: "2 weeks", days: 14 },
	{ id: "custom", label: "Custom", days: 0 },
] as const;

async function savePauses(pauses: Pause[]): Promise<void> {
	const r = await fetch("/api/program/settings", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ pauses }),
	});
	if (!r.ok) throw new Error("could not save the pause");
}

const same = (a: Pause, b: Pause) => a.start === b.start && a.end === b.end;

/** End the pause in effect today: it ends yesterday, or disappears if it
 *  only started today. */
async function endPause(pauses: readonly Pause[], paused: Pause, today: string): Promise<void> {
	await savePauses(paused.start >= today ? pauses.filter((p) => !same(p, paused)) : pauses.map((p) => (same(p, paused) ? { ...p, end: addDays(today, -1) } : p)));
}

/** In the program settings popover: start a declared break (streaks and
 *  pace skip paused days), or end the one in effect. */
export function PauseControl({ pauses, paused, today, onChanged }: { pauses: Pause[]; paused: Pause | null; today: string; onChanged: () => void }) {
	const [length, setLength] = useState<(typeof LENGTHS)[number]["id"]>("7");
	const [custom, setCustom] = useState("5");
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const days = length === "custom" ? Math.round(Number(custom)) : LENGTHS.find((l) => l.id === length)!.days;
	const valid = Number.isFinite(days) && days >= 1 && days <= 90;

	async function run(fn: () => Promise<void>) {
		setBusy(true);
		setError(null);
		try {
			await fn();
			onChanged();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	if (paused)
		return (
			<div className="space-y-2">
				<div className="text-xs text-muted-foreground">Taking a break</div>
				<p className="text-sm">
					Paused until {fmtDay(paused.end)}
					{paused.reason ? <span className="text-muted-foreground"> · {paused.reason}</span> : null}
				</p>
				<button
					type="button"
					disabled={busy}
					onClick={() => void run(() => endPause(pauses, paused, today))}
					className="w-full rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 pointer-coarse:min-h-11"
				>
					End pause
				</button>
				{error && <p className="text-xs text-destructive">{error}</p>}
			</div>
		);

	return (
		<div className="space-y-2">
			<div className="text-xs text-muted-foreground">Take a break — streaks and pace skip paused days</div>
			<div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Pause length">
				{LENGTHS.map((l) => (
					<button
						key={l.id}
						type="button"
						role="radio"
						aria-checked={length === l.id}
						onClick={() => setLength(l.id)}
						className={cn(
							"rounded-full border px-2.5 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3",
							length === l.id ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground",
						)}
					>
						{l.label}
					</button>
				))}
			</div>
			{length === "custom" && (
				<label className="flex items-center gap-2 text-xs text-muted-foreground">
					<input
						type="number"
						min={1}
						max={90}
						value={custom}
						onChange={(e) => setCustom(e.target.value)}
						className="lh-input w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground pointer-coarse:min-h-11"
					/>
					days
				</label>
			)}
			<input
				value={reason}
				onChange={(e) => setReason(e.target.value)}
				maxLength={120}
				placeholder="Reason (optional)"
				aria-label="Pause reason (optional)"
				className="lh-input w-full rounded-md border border-border bg-background px-2 py-1 text-sm pointer-coarse:min-h-11"
			/>
			<button
				type="button"
				disabled={busy || !valid}
				onClick={() =>
					void run(() => savePauses([...pauses, { start: today, end: addDays(today, days - 1), ...(reason.trim() ? { reason: reason.trim() } : {}) }]))
				}
				className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 pointer-coarse:min-h-11"
			>
				<PauseCircleIcon className="size-4" />
				{valid ? `Pause until ${fmtDay(addDays(today, days - 1))}` : "Pause 1–90 days"}
			</button>
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}

/** The calm banner at the top of home while a pause is in effect. */
export function PauseBanner({ pauses, paused, today, onChanged }: { pauses: Pause[]; paused: Pause; today: string; onChanged: () => void }) {
	const [busy, setBusy] = useState(false);
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm" role="status">
			<PauseCircleIcon className="size-5 shrink-0 text-[var(--st-available)]" />
			<span className="min-w-0 flex-1">
				Paused until {fmtDay(paused.end)} — enjoy the break.
				{paused.reason ? <span className="text-muted-foreground"> ({paused.reason})</span> : null}
			</span>
			<button
				type="button"
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					try {
						await endPause(pauses, paused, today);
						onChanged();
					} finally {
						setBusy(false);
					}
				}}
				className="rounded-lg border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 pointer-coarse:min-h-11"
			>
				End pause
			</button>
		</div>
	);
}
