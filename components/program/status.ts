import type { LessonStatus, ProgressSnapshot } from "@/src/core";

/** Status → CSS color var (globals.css program palette). */
export const STATUS_COLOR: Record<LessonStatus, string> = {
	locked: "var(--st-locked)",
	available: "var(--st-available)",
	"in-progress": "var(--st-progress)",
	mastered: "var(--st-mastered)",
	"review-due": "var(--st-review)",
};

export const STATUS_LABEL: Record<LessonStatus, string> = {
	locked: "Locked",
	available: "Ready",
	"in-progress": "In progress",
	mastered: "Mastered",
	"review-due": "Review due",
};

export const TRACK_COLOR: Record<string, string> = {
	math: "var(--tr-math)",
	physics: "var(--tr-physics)",
	survey: "var(--tr-survey)",
	capstone: "var(--tr-capstone)",
	elective: "var(--tr-elective)",
	chemphys: "var(--tr-chemphys)",
};

export const COURSE_STATUS_COLOR: Record<ProgressSnapshot["courses"][string]["status"], string> = {
	locked: "var(--st-locked)",
	available: "var(--st-available)",
	active: "var(--st-progress)",
	passed: "var(--st-mastered)",
};

export function pct(x: number): string {
	return `${Math.round(x * 100)}%`;
}

export function fmtDate(iso: string): string {
	return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
