"use client";

import { useCallback, useEffect, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { ProgressSnapshot } from "@/src/core";

/** The lean program shape (src/server/curriculum.ts ProgramView). Mirrored
 *  here because components may import only the core barrel. */
export interface ProgramView {
	id: string;
	title: string;
	summary: string;
	targetWeeks: number;
	hoursPerWeek: number;
	courses: CourseView[];
}
export interface CourseView {
	id: string;
	code: string;
	title: string;
	track: string;
	depth: string;
	hours: number;
	prereqs: string[];
	coreqs: string[];
	subject: string;
	summary: string;
	exams: { id: string; kind: string; title: string; minutes: number; passMark: number; covers: string[] }[];
	units: UnitView[];
}
export interface UnitView {
	id: string;
	title: string;
	summary: string;
	grad: boolean;
	lessons: { id: string; title: string; minutes: number; lectures: number; demos: number; prereqs: string[] }[];
}

export interface ProgramData {
	program: ProgramView;
	snapshot: ProgressSnapshot;
}

/** Program + snapshot, refreshed whenever the server says the ledger or
 *  caches changed (curriculum-changed) or the event channel resyncs. */
export function useProgram(initial: ProgramData | null): { data: ProgramData | null; error: string | null; refresh: () => void } {
	const [data, setData] = useState<ProgramData | null>(initial);
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(() => {
		fetch("/api/program")
			.then(async (r) => {
				const body = await r.json();
				if (!r.ok) throw new Error(body.error ?? r.statusText);
				setData(body as ProgramData);
				setError(null);
			})
			.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
	}, []);
	useEffect(() => {
		if (!initial) refresh();
	}, [initial, refresh]);
	useServerEvent("curriculum-changed", refresh);
	useServerResync(refresh);
	return { data, error, refresh };
}

export async function postProgressEvent(event: Record<string, unknown>): Promise<void> {
	await fetch("/api/program/events", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(event),
	});
}

/** Focus-aware study heartbeat: while the page is visible and the window
 *  focused, log a study_time event every 5 minutes (and on leave, the
 *  partial minutes ≥ 1). */
export function useStudyHeartbeat(lessonId?: string): void {
	useEffect(() => {
		let active = 0;
		let last = Date.now();
		const tickMs = 30_000;
		const visible = () => document.visibilityState === "visible" && document.hasFocus();
		const flush = (min = 5) => {
			const minutes = Math.floor(active / 60_000);
			if (minutes >= min) {
				active -= minutes * 60_000;
				void postProgressEvent({ type: "study_time", minutes, lessonId, source: "heartbeat" });
			}
		};
		const id = window.setInterval(() => {
			const now = Date.now();
			if (visible()) active += Math.min(now - last, tickMs * 2);
			last = now;
			flush();
		}, tickMs);
		const leave = () => flush(1);
		window.addEventListener("pagehide", leave);
		return () => {
			window.clearInterval(id);
			window.removeEventListener("pagehide", leave);
			leave();
		};
	}, [lessonId]);
}
