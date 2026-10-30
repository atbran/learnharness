"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeftIcon, MonitorPlayIcon, SparklesIcon, XIcon } from "lucide-react";
import type { LessonStatus, ProgressSnapshot } from "@/src/core";
import type { CourseView, ProgramView } from "./use-program";
import { COURSE_STATUS_COLOR, STATUS_COLOR, STATUS_LABEL, TRACK_COLOR, pct } from "./status";
import { ProgressRing } from "./charts";

/**
 * The program map. Overview: every course as a node, placed in columns by
 * prerequisite depth, colored by track, ringed by mastery; edges are course
 * prerequisites. Click a course to unfold it: units become columns of
 * lesson nodes colored by status (ready lessons glow). Click a lesson for
 * its drawer.
 */

type CourseNodeData = { course: CourseView; progress: ProgressSnapshot["courses"][string] | undefined };
type LessonNodeData = { id: string; title: string; status: LessonStatus; minutes: number; lectures: number; demos: number; index: number };
type UnitNodeData = { title: string; grad: boolean; mastered: number; total: number };

function CourseNode({ data }: NodeProps<Node<CourseNodeData>>) {
	const { course, progress } = data;
	const status = progress?.status ?? "locked";
	const color = TRACK_COLOR[course.track] ?? "var(--foreground)";
	const glow = status === "available" || status === "active";
	return (
		<div
			className={`flex w-[220px] cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-transform hover:scale-[1.03] ${glow ? "lh-glow" : ""}`}
			style={{ borderColor: COURSE_STATUS_COLOR[status], opacity: status === "locked" ? 0.6 : 1, ["--glow" as string]: COURSE_STATUS_COLOR[status] }}
		>
			<Handle type="target" position={Position.Left} className="!opacity-0" />
			<ProgressRing value={progress?.fraction ?? 0} size={46} stroke={5} color={color}>
				<span style={{ color }}>{course.code}</span>
			</ProgressRing>
			<div className="min-w-0">
				<div className="truncate text-[13px] font-medium leading-tight">{course.title}</div>
				<div className="mt-0.5 text-[11px] text-muted-foreground">
					{course.hours} h · {course.depth}
					{progress ? ` · ${progress.lessonsMastered}/${progress.lessonsTotal}` : ""}
				</div>
			</div>
			<Handle type="source" position={Position.Right} className="!opacity-0" />
		</div>
	);
}

function LessonNode({ data, selected }: NodeProps<Node<LessonNodeData>>) {
	const color = STATUS_COLOR[data.status];
	return (
		<div
			className={`flex w-[200px] cursor-pointer items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-[12px] transition-transform hover:scale-[1.04] ${data.status === "available" || data.status === "review-due" ? "lh-glow" : ""}`}
			style={{ borderColor: selected ? "var(--foreground)" : color, ["--glow" as string]: color, opacity: data.status === "locked" ? 0.55 : 1 }}
		>
			<Handle type="target" position={Position.Top} className="!opacity-0" />
			<span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
			<span className="min-w-0 flex-1 truncate">{data.title}</span>
			{data.lectures > 0 && <MonitorPlayIcon className="size-3 shrink-0 text-muted-foreground" />}
			<Handle type="source" position={Position.Bottom} className="!opacity-0" />
		</div>
	);
}

function UnitNode({ data }: NodeProps<Node<UnitNodeData>>) {
	return (
		<div className="w-[200px] px-1">
			<div className="text-[11px] uppercase tracking-wider text-muted-foreground">
				{data.grad ? "grad · " : ""}
				{data.mastered}/{data.total}
			</div>
			<div className="text-[13px] font-semibold leading-tight">{data.title}</div>
			<div className="mt-1 h-1 overflow-hidden rounded bg-accent">
				<div className="h-full bg-[var(--st-mastered)]" style={{ width: pct(data.mastered / Math.max(1, data.total)) }} />
			</div>
		</div>
	);
}

const nodeTypes = { course: CourseNode, lesson: LessonNode, unit: UnitNode };

function overviewGraph(program: ProgramView, snapshot: ProgressSnapshot): { nodes: Node[]; edges: Edge[] } {
	const depth = new Map<string, number>();
	const byId = new Map(program.courses.map((c) => [c.id, c]));
	const d = (id: string): number => {
		if (depth.has(id)) return depth.get(id)!;
		const c = byId.get(id);
		const v = c && c.prereqs.length ? 1 + Math.max(...c.prereqs.map(d)) : 0;
		depth.set(id, v);
		return v;
	};
	const cols = new Map<number, CourseView[]>();
	const trackRank: Record<string, number> = { math: 0, physics: 1, chemphys: 2, survey: 3, elective: 4, capstone: 5 };
	for (const c of program.courses) cols.set(d(c.id), [...(cols.get(d(c.id)) ?? []), c]);
	const nodes: Node[] = [];
	for (const [col, list] of cols) {
		list.sort((a, b) => (trackRank[a.track] ?? 9) - (trackRank[b.track] ?? 9));
		list.forEach((c, row) => {
			nodes.push({
				id: c.id,
				type: "course",
				position: { x: col * 280, y: row * 110 + (col % 2) * 30 },
				data: { course: c, progress: snapshot.courses[c.id] },
			});
		});
	}
	const known = new Set(program.courses.map((c) => c.id));
	// Co-requisites: taken alongside, never blocking — a dashed link.
	const pairs = new Set<string>();
	const coreqEdges: Edge[] = program.courses.flatMap((c) =>
		c.coreqs
			.filter((q) => {
				const key = [c.id, q].sort().join("~");
				if (!known.has(q) || pairs.has(key)) return false;
				pairs.add(key);
				return true;
			})
			.map((q) => ({ id: `${q}~${c.id}`, source: q, target: c.id, style: { stroke: "var(--tr-elective)", strokeDasharray: "5 5", strokeOpacity: 0.7 } })),
	);
	const edges: Edge[] = [...coreqEdges, ...program.courses.flatMap((c) =>
		c.prereqs.map((p) => {
			const ready = snapshot.courses[p]?.status === "passed";
			return {
				id: `${p}->${c.id}`,
				source: p,
				target: c.id,
				animated: ready && snapshot.courses[c.id]?.status !== "passed",
				style: { stroke: ready ? "var(--st-mastered)" : "var(--border)", strokeWidth: ready ? 2 : 1.25 },
			};
		}),
	)];
	return { nodes, edges };
}

function courseGraph(course: CourseView, snapshot: ProgressSnapshot): { nodes: Node[]; edges: Edge[] } {
	const nodes: Node[] = [];
	const edges: Edge[] = [];
	let prevLast: string | null = null;
	let n = 0;
	course.units.forEach((u, col) => {
		const x = col * 240;
		const mastered = u.lessons.filter((l) => snapshot.lessons[l.id]?.masteredAt).length;
		nodes.push({ id: u.id, type: "unit", position: { x, y: 0 }, data: { title: u.title, grad: u.grad, mastered, total: u.lessons.length }, selectable: false });
		u.lessons.forEach((l, row) => {
			nodes.push({
				id: l.id,
				type: "lesson",
				position: { x, y: 80 + row * 52 },
				data: { id: l.id, title: l.title, status: snapshot.lessons[l.id]?.status ?? "locked", minutes: l.minutes, lectures: l.lectures, demos: l.demos, index: ++n },
			});
			const prev = row > 0 ? u.lessons[row - 1]!.id : prevLast;
			if (prev) {
				const done = !!snapshot.lessons[prev]?.masteredAt;
				edges.push({
					id: `${prev}->${l.id}`,
					source: prev,
					target: l.id,
					type: row === 0 ? "smoothstep" : "straight",
					style: { stroke: done ? "var(--st-mastered)" : "var(--border)", strokeWidth: done ? 2 : 1 },
				});
			}
			for (const p of l.prereqs)
				edges.push({ id: `${p}=>${l.id}`, source: p, target: l.id, type: "smoothstep", style: { stroke: "var(--st-review)", strokeDasharray: "4 4", strokeOpacity: 0.6 } });
		});
		prevLast = u.lessons.at(-1)?.id ?? prevLast;
	});
	return { nodes, edges };
}

export function ProgramMap({ program, snapshot }: { program: ProgramView; snapshot: ProgressSnapshot }) {
	const router = useRouter();
	const [courseId, setCourseId] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const course = courseId ? program.courses.find((c) => c.id === courseId) ?? null : null;
	const graph = useMemo(() => (course ? courseGraph(course, snapshot) : overviewGraph(program, snapshot)), [course, program, snapshot]);
	const lesson = course && selected ? course.units.flatMap((u) => u.lessons).find((l) => l.id === selected) : undefined;
	const lp = selected ? snapshot.lessons[selected] : undefined;

	return (
		<div className="relative h-[calc(100vh-260px)] min-h-[520px] overflow-hidden rounded-xl border border-border bg-background short:h-[calc(100dvh-5rem)] short:min-h-60">
			<ReactFlow
				key={courseId ?? "overview"}
				nodes={graph.nodes}
				edges={graph.edges}
				nodeTypes={nodeTypes}
				fitView
				fitViewOptions={{ padding: 0.08, minZoom: course ? 0.75 : 0.5, maxZoom: 1.1, nodes: course ? graph.nodes.slice(0, 40).map((n) => ({ id: n.id })) : undefined }}
				minZoom={0.15}
				maxZoom={2}
				nodesDraggable={false}
				nodesConnectable={false}
				proOptions={{ hideAttribution: true }}
				colorMode="dark"
				onNodeClick={(_, node) => {
					if (node.type === "course") setCourseId(node.id);
					else if (node.type === "lesson") setSelected(node.id);
				}}
				onNodeDoubleClick={(_, node) => {
					if (node.type === "lesson") router.push(`/program/lesson/${node.id}`);
					if (node.type === "course") router.push(`/program/course/${node.id}`);
				}}
				onPaneClick={() => setSelected(null)}
			>
				<Background gap={28} size={1} color="#2a2a2a" />
				{/* Touch: the zoom/fit buttons grow to 44px targets (the xyflow
				    stylesheet is unlayered, hence the important). Pinch-zoom and
				    one-finger pan are xyflow defaults (zoomOnPinch, panOnDrag). */}
				<Controls showInteractive={false} className="pointer-coarse:[&_button]:size-11!" />
				{/* Phone: no room for the minimap; the legend takes its corner. */}
				<MiniMap
					className="max-sm:hidden! short:hidden!"
					pannable
					zoomable
					maskColor="rgba(20,20,20,0.7)"
					style={{ background: "#1c1c1c" }}
					nodeColor={(n) =>
						n.type === "course"
							? COURSE_STATUS_COLOR[(n.data as CourseNodeData).progress?.status ?? "locked"]
							: n.type === "lesson"
								? STATUS_COLOR[(n.data as LessonNodeData).status]
								: "transparent"
					}
				/>
			</ReactFlow>

			<div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
				{course ? (
					<button
						type="button"
						onClick={() => {
							setCourseId(null);
							setSelected(null);
						}}
						className="pointer-events-auto flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-accent pointer-coarse:min-h-11"
					>
						<ArrowLeftIcon className="size-3.5" /> All courses
					</button>
				) : (
					<div className="rounded-lg border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground">
						<span className="pointer-coarse:hidden">Click a course to unfold it · double-click to open</span>
						{/* Touch has no double-click: a tapped course unfolds and
						    the "Open …" link below it opens the course page. */}
						<span className="hidden pointer-coarse:inline">Tap a course to unfold it · pinch to zoom</span>
					</div>
				)}
				{course && (
					<Link href={`/program/course/${course.id}`} className="pointer-events-auto flex w-fit items-center gap-1 rounded-lg border border-border bg-card/90 px-3 py-1.5 text-xs pointer-coarse:min-h-11">
						<span className="hidden pointer-coarse:inline">Open</span>
						<span style={{ color: TRACK_COLOR[course.track] }}>{course.code}</span> {course.title} →
					</Link>
				)}
			</div>

			<div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-3 rounded-lg border border-border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground max-sm:left-auto max-sm:right-3 max-sm:max-w-[calc(100%-5rem)] max-sm:translate-x-0 max-sm:flex-wrap max-sm:justify-end max-sm:gap-x-2.5 max-sm:gap-y-0.5">
				{(Object.keys(STATUS_LABEL) as LessonStatus[]).map((s) => (
					<span key={s} className="flex items-center gap-1 whitespace-nowrap">
						<span className="size-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
						{STATUS_LABEL[s]}
					</span>
				))}
			</div>

			{lesson && lp && (
				<div className="absolute right-3 top-3 w-[300px] rounded-xl border border-border bg-card p-4 shadow-xl">
					<button type="button" onClick={() => setSelected(null)} className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-accent pointer-coarse:p-3" aria-label="Close">
						<XIcon className="size-3.5" />
					</button>
					<div className="text-[11px] uppercase tracking-wider" style={{ color: STATUS_COLOR[lp.status] }}>
						{STATUS_LABEL[lp.status]}
						{lp.testedOut ? " · tested out" : ""}
					</div>
					<div className="mt-1 pr-5 text-[15px] font-semibold leading-snug">{lesson.title}</div>
					<div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
						<span>{lesson.minutes} min</span>
						{lesson.lectures > 0 && (
							<span className="flex items-center gap-1">
								<MonitorPlayIcon className="size-3" /> {lesson.lectures} lecture{lesson.lectures > 1 ? "s" : ""}
							</span>
						)}
						{lesson.demos > 0 && (
							<span className="flex items-center gap-1">
								<SparklesIcon className="size-3" /> {lesson.demos} demo idea{lesson.demos > 1 ? "s" : ""}
							</span>
						)}
						{lp.bestCheck !== null && <span>best check {pct(lp.bestCheck)}</span>}
						{lp.review && <span>review {lp.review.due}</span>}
					</div>
					<Link
						href={`/program/lesson/${lesson.id}`}
						className="mt-3 flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground hover:opacity-90 pointer-coarse:min-h-11"
					>
						Open lesson
					</Link>
				</div>
			)}
		</div>
	);
}
