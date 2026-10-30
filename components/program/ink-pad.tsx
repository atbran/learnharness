"use client";

/**
 * Ink pad: write a problem's solution with an Apple Pencil (or a mouse / PC
 * drawing tablet), save each page as a PNG upload the grader reads like a photo.
 *
 * Latency follows QNova's iPad ink (qnova-ipad/web/ink.js + spectrum.js):
 * the live stroke is painted inside pointermove from every coalesced sample,
 * with the predicted tail (getPredictedEvents, else a short extrapolation) on
 * a separate desynchronized canvas; committed ink is repainted only when the
 * stroke list changes. Palm rejection is QNova's too: once a pen is seen,
 * fingers never draw; while the pen is down (and 350 ms after it lifts) touches
 * are ignored, and a lost pen-up stops locking fingers out after 2.5 s.
 *
 * Strokes are stored in page units (PAGE_W × PAGE_H, A4 portrait) so a draft
 * keeps its shape in portrait, landscape and on the PC; drafts autosave to
 * IndexedDB per assessment + problem + page.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import {
	AlignJustifyIcon,
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	EraserIcon,
	FilePlusIcon,
	FileXIcon,
	Grid3x3Icon,
	HandIcon,
	HighlighterIcon,
	Loader2Icon,
	Redo2Icon,
	SquareIcon,
	Trash2Icon,
	Undo2Icon,
	UploadIcon,
	XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Page model (pure; tested in tests/ink-pad.test.ts) ──────────────────────

/** Page size in page units (A4 portrait). Exported at EXPORT_SCALE× → 1600 × 2264 px. */
export const PAGE_W = 800;
export const PAGE_H = 1132;
export const EXPORT_SCALE = 2;

export type Paper = "blank" | "grid" | "lined";
export type InkTool = "pen" | "highlighter" | "eraser";
export const PEN_COLORS = { black: "#111111", blue: "#1d4ed8", red: "#dc2626" } as const;
export const HIGHLIGHTER_COLOR = "#fde047";
const PEN_SIZE = 3.2;
const HIGHLIGHTER_SIZE = 22;
const HIGHLIGHTER_ALPHA = 0.7;
const ERASER_RADIUS = 10;

export interface Stroke {
	id: string;
	tool: "pen" | "highlighter";
	color: string;
	size: number;
	/** True when the pressure is real (a pen); otherwise perfect-freehand simulates it from speed. */
	pressure: boolean;
	/** Flat [x, y, p, x, y, p, …] in page units. */
	pts: number[];
}

export interface InkPage {
	aid: string;
	pid: string;
	/** 0-based page number within the problem (part of the IndexedDB key). */
	page: number;
	paper: Paper;
	strokes: Stroke[];
	/** Upload file name of the last saved PNG of this page, if any. */
	upload: string | null;
	/** Strokes or paper changed since `upload` was made. */
	dirty: boolean;
	updatedAt: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Append one sample to a flat point list (x, y to 0.1 unit, pressure to 0.01). */
export function pushPoint(pts: number[], x: number, y: number, p: number): void {
	pts.push(r1(x), r1(y), r2(Math.min(1, Math.max(0, p))));
}

export function strokePoints(s: Pick<Stroke, "pts">): [number, number, number][] {
	const out: [number, number, number][] = [];
	for (let i = 0; i + 2 < s.pts.length; i += 3) out.push([s.pts[i]!, s.pts[i + 1]!, s.pts[i + 2]!]);
	return out;
}

/** perfect-freehand outline of a stroke; `extra` are predicted points drawn but not stored. */
export function strokeOutline(s: Stroke, extra: [number, number, number][] = [], last = true): number[][] {
	const pts = strokePoints(s).concat(extra);
	if (s.tool === "highlighter")
		return getStroke(pts, { size: s.size, thinning: 0, smoothing: 0.6, streamline: 0.4, simulatePressure: false, start: { cap: true }, end: { cap: true }, last });
	return getStroke(pts, {
		size: s.size,
		thinning: s.pressure ? 0.65 : 0.45,
		smoothing: 0.5,
		streamline: 0.25,
		simulatePressure: !s.pressure,
		start: { cap: true, taper: 0 },
		end: { cap: true, taper: 0 },
		last,
	});
}

/** SVG path data for an outline (quadratic curves through the midpoints: smooth, no polygon corners). */
export function outlineToPath(outline: number[][]): string {
	const n = outline.length;
	if (n < 3) return "";
	const f = (v: number) => (Math.round(v * 100) / 100).toString();
	const [x0, y0] = outline[0]!;
	const [x1, y1] = outline[1]!;
	let d = `M${f(x0!)},${f(y0!)} Q${f(x1!)},${f(y1!)} ${f((x1! + outline[2]![0]!) / 2)},${f((y1! + outline[2]![1]!) / 2)} T`;
	for (let i = 2; i < n - 1; i++) {
		const a = outline[i]!;
		const b = outline[i + 1]!;
		d += `${f((a[0]! + b[0]!) / 2)},${f((a[1]! + b[1]!) / 2)} `;
	}
	return `${d}Z`;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does a circle of radius r at (x, y) touch the stroke? */
export function strokeHit(s: Stroke, x: number, y: number, r: number): boolean {
	const rr = r + s.size / 2;
	const p = s.pts;
	if (p.length < 3) return false;
	if (p.length < 6) return Math.hypot(x - p[0]!, y - p[1]!) <= rr;
	for (let i = 3; i + 2 < p.length; i += 3) if (segDist(x, y, p[i - 3]!, p[i - 2]!, p[i]!, p[i + 1]!) <= rr) return true;
	return false;
}

/** Stroke eraser: drops every stroke the eraser touches. Returns the same array when nothing was hit. */
export function eraseAt(strokes: Stroke[], x: number, y: number, r = ERASER_RADIUS): Stroke[] {
	const keep = strokes.filter((s) => !strokeHit(s, x, y, r));
	return keep.length === strokes.length ? strokes : keep;
}

export function blankPage(aid: string, pid: string, page: number, paper: Paper): InkPage {
	return { aid, pid, page, paper, strokes: [], upload: null, dirty: false, updatedAt: Date.now() };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates a page read back from IndexedDB (another version of this file may have written it). */
export function normalizePage(raw: unknown, aid: string, pid: string): InkPage | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (o.aid !== aid || o.pid !== pid || !isNum(o.page)) return null;
	const strokes: Stroke[] = [];
	for (const s of Array.isArray(o.strokes) ? (o.strokes as unknown[]) : []) {
		if (!s || typeof s !== "object") continue;
		const t = s as Record<string, unknown>;
		if ((t.tool !== "pen" && t.tool !== "highlighter") || typeof t.color !== "string" || !isNum(t.size) || !Array.isArray(t.pts)) continue;
		const pts = t.pts as unknown[];
		if (pts.length < 3 || pts.length % 3 !== 0 || !pts.every(isNum)) continue;
		strokes.push({ id: typeof t.id === "string" ? t.id : newId(), tool: t.tool, color: t.color, size: t.size, pressure: t.pressure === true, pts: pts as number[] });
	}
	return {
		aid,
		pid,
		page: o.page,
		paper: o.paper === "grid" || o.paper === "lined" ? o.paper : "blank",
		strokes,
		upload: typeof o.upload === "string" ? o.upload : null,
		dirty: o.dirty === true,
		updatedAt: isNum(o.updatedAt) ? o.updatedAt : 0,
	};
}

/** A saved page whose upload is no longer in the answer (its thumbnail was removed) is a draft again. */
export function reconcileUploads(pages: InkPage[], images: string[]): InkPage[] {
	return pages.map((p) => (p.upload && !images.includes(p.upload) ? { ...p, upload: null, dirty: p.strokes.length > 0 } : p));
}

export function newId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Painting (canvas) ───────────────────────────────────────────────────────

const pathCache = new WeakMap<Stroke, Path2D>();
function strokePath(s: Stroke): Path2D {
	let p = pathCache.get(s);
	if (!p) {
		p = new Path2D(outlineToPath(strokeOutline(s)));
		pathCache.set(s, p);
	}
	return p;
}

function drawPaper(ctx: CanvasRenderingContext2D, paper: Paper): void {
	if (paper === "blank") return;
	ctx.save();
	ctx.lineWidth = 0.8;
	ctx.beginPath();
	if (paper === "grid") {
		ctx.strokeStyle = "#d3dce8";
		for (let x = 20; x < PAGE_W; x += 20) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, PAGE_H);
		}
		for (let y = 20; y < PAGE_H; y += 20) {
			ctx.moveTo(0, y);
			ctx.lineTo(PAGE_W, y);
		}
		ctx.stroke();
	} else {
		ctx.strokeStyle = "#c5d4e8";
		for (let y = 90; y < PAGE_H - 20; y += 30) {
			ctx.moveTo(0, y);
			ctx.lineTo(PAGE_W, y);
		}
		ctx.stroke();
		ctx.beginPath();
		ctx.strokeStyle = "#f0b4b4";
		ctx.moveTo(72, 0);
		ctx.lineTo(72, PAGE_H);
		ctx.stroke();
	}
	ctx.restore();
}

/** Paints paper + ink at k device pixels per page unit (highlighter under the pen, multiplied like real ink). */
function paintPage(ctx: CanvasRenderingContext2D, page: Pick<InkPage, "paper" | "strokes">, k: number): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	ctx.setTransform(k, 0, 0, k, 0, 0);
	drawPaper(ctx, page.paper);
	ctx.globalCompositeOperation = "multiply";
	ctx.globalAlpha = HIGHLIGHTER_ALPHA;
	for (const s of page.strokes)
		if (s.tool === "highlighter") {
			ctx.fillStyle = s.color;
			ctx.fill(strokePath(s));
		}
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	for (const s of page.strokes)
		if (s.tool === "pen") {
			ctx.fillStyle = s.color;
			ctx.fill(strokePath(s));
		}
}

/** The live layer's context. The first getContext call fixes the options, so every caller goes through here. */
function liveContext(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
	return c.getContext("2d", { desynchronized: true, alpha: true });
}

function exportPng(page: InkPage): Promise<Blob> {
	const c = document.createElement("canvas");
	c.width = PAGE_W * EXPORT_SCALE;
	c.height = PAGE_H * EXPORT_SCALE;
	const ctx = c.getContext("2d", { alpha: false });
	if (!ctx) return Promise.reject(new Error("canvas unavailable"));
	paintPage(ctx, page, EXPORT_SCALE);
	return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
}

// ─── IndexedDB drafts ────────────────────────────────────────────────────────

const DB_NAME = "learnharness-ink";
const STORE = "pages";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	dbPromise ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: ["aid", "pid", "page"] });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
	});
	dbPromise.catch(() => {
		dbPromise = null;
	});
	return dbPromise;
}

const pageRange = (aid: string, pid: string, from = 0) => IDBKeyRange.bound([aid, pid, from], [aid, pid, 1e9]);

async function loadDraft(aid: string, pid: string): Promise<InkPage[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll(pageRange(aid, pid));
		req.onsuccess = () =>
			resolve(
				(req.result as unknown[])
					.map((r) => normalizePage(r, aid, pid))
					.filter((p): p is InkPage => p !== null)
					.sort((a, b) => a.page - b.page),
			);
		req.onerror = () => reject(req.error ?? new Error("draft read failed"));
	});
}

/** Writes the pages that changed since `written`, drops page records past the end. */
async function saveDraft(aid: string, pid: string, pages: InkPage[], written: (InkPage | undefined)[]): Promise<void> {
	const db = await openDb();
	const empty = pages.every((p) => p.strokes.length === 0 && !p.upload);
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		const st = tx.objectStore(STORE);
		if (empty) st.delete(pageRange(aid, pid));
		else {
			st.delete(pageRange(aid, pid, pages.length));
			pages.forEach((p, i) => {
				if (written[i] !== p || p.page !== i) st.put({ ...p, page: i });
			});
		}
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("draft write failed"));
	});
}

// ─── Preferences ─────────────────────────────────────────────────────────────

function pref(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}
function setPref(key: string, value: string): void {
	try {
		window.localStorage.setItem(key, value);
	} catch {
		/* private mode: the choice lasts this session only */
	}
}
const PREF_PEN_SEEN = "lh-ink-pen-seen";
const PREF_FINGER = "lh-ink-finger-draws";
const PREF_PAPER = "lh-ink-paper";

// ─── Component ───────────────────────────────────────────────────────────────

type Pt = [number, number, number];
interface PointerState {
	id: number | null;
	kind: string;
	stroke: Stroke | null;
	/** Strokes before the eraser gesture began (for one undo step). */
	before: Stroke[] | null;
	rect: DOMRect | null;
	recent: { x: number; y: number; t: number }[];
	penDown: boolean;
	penLast: number;
	lastPenUp: number;
}

export function InkPad({
	assessmentId,
	problemId,
	label,
	images,
	onClose,
	onUploaded,
}: {
	assessmentId: string;
	problemId: string;
	label: string;
	/** The answer's current uploads (to notice a saved page whose thumbnail was removed). */
	images: string[];
	onClose: () => void;
	onUploaded: () => void;
}) {
	const [pages, setPages] = useState<InkPage[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [storageError, setStorageError] = useState<string | null>(null);
	const [idx, setIdx] = useState(0);
	const [tool, setTool] = useState<InkTool>("pen");
	const [color, setColor] = useState<string>(PEN_COLORS.black);
	const [fingerDraws, setFingerDraws] = useState<boolean>(() => {
		const f = pref(PREF_FINGER);
		return f ? f === "1" : pref(PREF_PEN_SEEN) !== "1";
	});
	const [relaxTouch, setRelaxTouch] = useState(false);
	const [dispW, setDispW] = useState(0);
	const [hist, setHist] = useState({ undo: 0, redo: 0 });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const scrollRef = useRef<HTMLDivElement>(null);
	const baseRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const ptr = useRef<PointerState>({ id: null, kind: "", stroke: null, before: null, rect: null, recent: [], penDown: false, penLast: 0, lastPenUp: -1e9 });
	const history = useRef(new Map<number, { past: Stroke[][]; future: Stroke[][] }>());
	const written = useRef<(InkPage | undefined)[]>([]);
	const pending = useRef<InkPage[] | null>(null);

	const page = pages[idx];
	const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
	const scale = dispW / PAGE_W;
	const k = scale * dpr;

	// Everything the native pointer handlers read, refreshed every render.
	const view = useRef({ tool, color, fingerDraws, strokes: [] as Stroke[], scale, k, loaded });
	const act = useRef({ addStroke: (_s: Stroke) => {}, erased: (_next: Stroke[]) => {}, eraseDone: (_before: Stroke[]) => {}, penSeen: () => {} });

	// ── load the draft ──
	useEffect(() => {
		let live = true;
		const fallback = pref(PREF_PAPER);
		const paper: Paper = fallback === "grid" || fallback === "lined" ? fallback : "blank";
		loadDraft(assessmentId, problemId)
			.then((stored) => {
				if (!live) return;
				written.current = stored;
				setPages(stored.length ? reconcileUploads(stored, images) : [blankPage(assessmentId, problemId, 0, paper)]);
				setLoaded(true);
			})
			.catch((err: unknown) => {
				if (!live) return;
				setStorageError(`Drafts can't be kept on this device (${err instanceof Error ? err.message : String(err)}). Save pages before closing.`);
				setPages([blankPage(assessmentId, problemId, 0, paper)]);
				setLoaded(true);
			});
		return () => {
			live = false;
		};
		// `images` is read once at open on purpose: reconciling while open would race our own uploads.
	}, [assessmentId, problemId]);

	// ── autosave (debounced) + flush on hide / close ──
	const flush = useCallback(() => {
		const p = pending.current;
		if (!p || storageError) return;
		pending.current = null;
		void saveDraft(assessmentId, problemId, p, written.current)
			.then(() => {
				written.current = p.map((q, i) => (q.page === i ? q : undefined));
			})
			.catch((err: unknown) => setStorageError(`Draft not saved: ${err instanceof Error ? err.message : String(err)}`));
	}, [assessmentId, problemId, storageError]);
	useEffect(() => {
		if (!loaded) return;
		pending.current = pages;
		const t = window.setTimeout(flush, 250);
		return () => window.clearTimeout(t);
	}, [pages, loaded, flush]);
	useEffect(() => {
		const hide = () => {
			if (document.visibilityState === "hidden") flush();
		};
		document.addEventListener("visibilitychange", hide);
		window.addEventListener("pagehide", flush);
		return () => {
			document.removeEventListener("visibilitychange", hide);
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, [flush]);

	// ── fit the page to the width ──
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const fit = () => setDispW(Math.round(Math.max(280, Math.min(1000, el.clientWidth - 32))));
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// iPad: once fingers stop drawing they scroll and pinch natively; the Pencil is held back in touchstart.
	// Elsewhere touch-action stays none (Chromium lets a pen pan when touch-action allows it).
	useEffect(() => {
		const apple = navigator.maxTouchPoints > 1 && /iPad|iPhone|Macintosh/.test(navigator.userAgent);
		setRelaxTouch(apple);
	}, []);

	// ── history ──
	const syncHist = useCallback((i: number) => {
		const h = history.current.get(i);
		setHist({ undo: h?.past.length ?? 0, redo: h?.future.length ?? 0 });
	}, []);
	useEffect(() => syncHist(idx), [idx, syncHist]);

	const setStrokes = useCallback(
		(next: Stroke[], before: Stroke[] | null) => {
			if (before) {
				const h = history.current.get(idx) ?? { past: [], future: [] };
				h.past.push(before);
				if (h.past.length > 200) h.past.shift();
				h.future = [];
				history.current.set(idx, h);
				syncHist(idx);
			}
			view.current.strokes = next;
			setPages((ps) => ps.map((p, i) => (i === idx ? { ...p, strokes: next, dirty: true, updatedAt: Date.now() } : p)));
		},
		[idx, syncHist],
	);

	const undo = useCallback(() => {
		const h = history.current.get(idx);
		const prev = h?.past.pop();
		if (!h || !prev || ptr.current.id !== null) return;
		h.future.push(view.current.strokes);
		setStrokes(prev, null);
		syncHist(idx);
	}, [idx, setStrokes, syncHist]);
	const redo = useCallback(() => {
		const h = history.current.get(idx);
		const next = h?.future.pop();
		if (!h || !next || ptr.current.id !== null) return;
		h.past.push(view.current.strokes);
		setStrokes(next, null);
		syncHist(idx);
	}, [idx, setStrokes, syncHist]);

	// ── canvases ──
	useLayoutEffect(() => {
		view.current = { tool, color, fingerDraws, strokes: page?.strokes ?? [], scale, k, loaded };
		act.current = {
			addStroke: (s) => {
				const base = baseRef.current?.getContext("2d");
				if (base) {
					// paint it now so lifting the pen never flashes; the full repaint follows the state update
					base.setTransform(k, 0, 0, k, 0, 0);
					base.globalCompositeOperation = s.tool === "highlighter" ? "multiply" : "source-over";
					base.globalAlpha = s.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
					base.fillStyle = s.color;
					base.fill(strokePath(s));
				}
				setStrokes([...view.current.strokes, s], view.current.strokes);
			},
			erased: (next) => {
				view.current.strokes = next;
				const base = baseRef.current?.getContext("2d");
				if (base && page) paintPage(base, { paper: page.paper, strokes: next }, k);
			},
			eraseDone: (before) => {
				if (view.current.strokes !== before) setStrokes(view.current.strokes, before);
			},
			penSeen: () => {
				if (pref(PREF_PEN_SEEN) === "1") return;
				setPref(PREF_PEN_SEEN, "1");
				setPref(PREF_FINGER, "0");
				setFingerDraws(false);
			},
		};
	});

	useLayoutEffect(() => {
		const base = baseRef.current;
		const live = liveRef.current;
		if (!base || !live || !dispW) return;
		const w = Math.round(PAGE_W * k);
		const h = Math.round(PAGE_H * k);
		for (const c of [base, live])
			if (c.width !== w || c.height !== h) {
				c.width = w;
				c.height = h;
			}
	}, [dispW, k]);

	useLayoutEffect(() => {
		const ctx = baseRef.current?.getContext("2d", { alpha: false });
		if (!ctx || !page || !dispW) return;
		paintPage(ctx, page, k);
		const live = liveRef.current;
		if (live && ptr.current.id === null) liveContext(live)?.clearRect(0, 0, live.width, live.height);
	}, [page, dispW, k]);

	// ── pointer input (native listeners: coalesced + predicted events, non-passive) ──
	useEffect(() => {
		const el = liveRef.current;
		if (!el) return;
		const S = ptr.current;
		const lctx = () => liveContext(el);
		const toPage = (cx: number, cy: number): [number, number] => {
			const r = S.rect ?? el.getBoundingClientRect();
			const sc = view.current.scale || 1;
			return [(cx - r.left) / sc, (cy - r.top) / sc];
		};
		const pressureOf = (e: PointerEvent) => (e.pointerType === "pen" ? e.pressure || 0.5 : 0.5);
		const clearLive = () => {
			const c = lctx();
			if (!c) return;
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.clearRect(0, 0, el.width, el.height);
		};
		const drawLive = (pred: Pt[]) => {
			const c = lctx();
			const s = S.stroke;
			if (!c || !s) return;
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.clearRect(0, 0, el.width, el.height);
			const kk = view.current.k;
			c.setTransform(kk, 0, 0, kk, 0, 0);
			c.globalAlpha = s.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
			c.fillStyle = s.color;
			c.fill(new Path2D(outlineToPath(strokeOutline(s, pred, false))));
		};
		const eraserRing = (x: number, y: number) => {
			const c = lctx();
			if (!c) return;
			c.setTransform(1, 0, 0, 1, 0, 0);
			c.clearRect(0, 0, el.width, el.height);
			const kk = view.current.k;
			c.setTransform(kk, 0, 0, kk, 0, 0);
			c.globalAlpha = 1;
			c.strokeStyle = "#64748b";
			c.lineWidth = 1.2;
			c.beginPath();
			c.arc(x, y, ERASER_RADIUS, 0, Math.PI * 2);
			c.stroke();
		};
		const erase = (x: number, y: number) => {
			const next = eraseAt(view.current.strokes, x, y);
			if (next !== view.current.strokes) act.current.erased(next);
		};
		const release = () => {
			if (S.id !== null)
				try {
					el.releasePointerCapture(S.id);
				} catch {
					/* already released */
				}
			S.id = null;
			S.rect = null;
			el.style.mixBlendMode = "";
		};

		const down = (e: PointerEvent) => {
			const v = view.current;
			if (!v.loaded) return;
			const now = performance.now();
			if (e.pointerType === "pen") act.current.penSeen();
			if (e.pointerType === "mouse" && e.button !== 0) return;
			if (e.pointerType === "touch") {
				if (!v.fingerDraws) return; // fingers scroll / pinch
				if (S.penDown && now - S.penLast > 2500) S.penDown = false; // a lost pen-up must not lock fingers out
				if (S.penDown || now - S.lastPenUp < 350) {
					e.preventDefault(); // a palm while the pen works
					return;
				}
			}
			if (S.id !== null) {
				if (e.pointerType !== "pen" || S.kind !== "touch") return;
				// the pen arrived while a "finger" stroke was going: that was the palm
				S.stroke = null;
				S.before = null;
				clearLive();
				release();
			}
			e.preventDefault();
			try {
				el.setPointerCapture(e.pointerId);
			} catch {
				/* synthetic events have no active pointer */
			}
			if (e.pointerType === "pen") {
				S.penDown = true;
				S.penLast = now;
			}
			S.id = e.pointerId;
			S.kind = e.pointerType;
			S.rect = el.getBoundingClientRect();
			const [x, y] = toPage(e.clientX, e.clientY);
			S.recent = [{ x, y, t: e.timeStamp }];
			if (v.tool === "eraser") {
				S.before = v.strokes;
				erase(x, y);
				eraserRing(x, y);
				return;
			}
			const hl = v.tool === "highlighter";
			S.stroke = { id: newId(), tool: hl ? "highlighter" : "pen", color: hl ? HIGHLIGHTER_COLOR : v.color, size: hl ? HIGHLIGHTER_SIZE : PEN_SIZE, pressure: e.pointerType === "pen", pts: [] };
			pushPoint(S.stroke.pts, x, y, pressureOf(e));
			if (hl) el.style.mixBlendMode = "multiply";
			drawLive([]);
		};

		const move = (e: PointerEvent) => {
			if (e.pointerId !== S.id) {
				// hover (pen or mouse): show the eraser's reach
				if (S.id === null && view.current.tool === "eraser" && e.pointerType !== "touch") {
					const [x, y] = toPage(e.clientX, e.clientY);
					eraserRing(x, y);
				}
				return;
			}
			e.preventDefault();
			if (S.penDown) S.penLast = performance.now();
			const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
			const samples = list.length ? list : [e];
			const s = S.stroke;
			for (const ce of samples) {
				const [x, y] = toPage(ce.clientX, ce.clientY);
				if (!s) {
					erase(x, y);
					continue;
				}
				const n = s.pts.length;
				if (Math.abs(x - s.pts[n - 3]!) + Math.abs(y - s.pts[n - 2]!) < 0.3) continue;
				pushPoint(s.pts, x, y, pressureOf(ce));
				S.recent.push({ x, y, t: ce.timeStamp });
			}
			if (S.recent.length > 6) S.recent.splice(0, S.recent.length - 6);
			if (!s) {
				const [x, y] = toPage(e.clientX, e.clientY);
				eraserRing(x, y);
				return;
			}
			drawLive(predict(e, s));
		};

		// the predicted tail: the browser's own prediction, else QNova's ~14 ms extrapolation
		const predict = (e: PointerEvent, s: Stroke): Pt[] => {
			const n = s.pts.length;
			const p = s.pts[n - 1] ?? 0.5;
			if (typeof e.getPredictedEvents === "function") {
				const pe = e.getPredictedEvents();
				if (pe.length) return pe.map((q) => [...toPage(q.clientX, q.clientY), p] as Pt);
			}
			const h = S.recent;
			if (h.length < 3) return [];
			const a = h[h.length - 3]!;
			const b = h[h.length - 1]!;
			const dt = b.t - a.t;
			if (dt <= 0 || dt > 60) return [];
			const f = Math.min(14 / dt, 1.5);
			return [[b.x + (b.x - a.x) * f, b.y + (b.y - a.y) * f, p]];
		};

		const up = (e: PointerEvent) => {
			if (e.pointerType === "pen") {
				S.penDown = false;
				S.lastPenUp = performance.now();
			}
			if (e.pointerId !== S.id) return;
			release();
			if (S.before) {
				const before = S.before;
				S.before = null;
				clearLive();
				act.current.eraseDone(before);
				return;
			}
			const s = S.stroke;
			S.stroke = null;
			clearLive();
			// a cancelled stroke is kept: losing ink is worse than a stray mark (undo removes it)
			if (s && s.pts.length >= 3) act.current.addStroke(s);
		};
		const leave = (e: PointerEvent) => {
			if (S.id === null && e.pointerType !== "touch") clearLive();
		};

		// iOS: keep the Pencil (and palms while it writes) from scrolling, the magnifier and callouts
		const touch = (e: TouchEvent) => {
			const stylus = Array.from(e.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
			if ((stylus || view.current.fingerDraws || S.penDown || performance.now() - S.lastPenUp < 350) && e.cancelable) e.preventDefault();
		};

		el.addEventListener("pointerdown", down, { passive: false });
		el.addEventListener("pointermove", move, { passive: false });
		el.addEventListener("pointerup", up);
		el.addEventListener("pointercancel", up);
		el.addEventListener("pointerleave", leave);
		el.addEventListener("touchstart", touch, { passive: false });
		el.addEventListener("touchmove", touch, { passive: false });
		const noMenu = (e: Event) => e.preventDefault();
		el.addEventListener("contextmenu", noMenu);
		return () => {
			el.removeEventListener("pointerdown", down);
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
			el.removeEventListener("pointercancel", up);
			el.removeEventListener("pointerleave", leave);
			el.removeEventListener("touchstart", touch);
			el.removeEventListener("touchmove", touch);
			el.removeEventListener("contextmenu", noMenu);
		};
	}, []);

	// ── pages, paper, save ──
	const unsaved = pages.filter((p) => p.strokes.length > 0 && (!p.upload || p.dirty)).length;
	const close = useCallback(() => {
		if (ptr.current.id !== null) return;
		if (unsaved > 0 && !window.confirm(`${unsaved === 1 ? "A page isn't" : `${unsaved} pages aren't`} saved to your answer yet. ${storageError ? "Drafts can't be kept on this device, so unsaved ink will be lost." : "It stays here as a draft, but the grader only sees saved pages."} Close anyway?`))
			return;
		flush();
		onClose();
	}, [unsaved, storageError, flush, onClose]);

	const setPaper = (paper: Paper) => {
		setPref(PREF_PAPER, paper);
		setPages((ps) => ps.map((p, i) => (i === idx && p.paper !== paper ? { ...p, paper, dirty: true, updatedAt: Date.now() } : p)));
	};
	const goTo = (i: number) => {
		if (ptr.current.id !== null || i < 0 || i >= pages.length) return;
		setIdx(i);
		scrollRef.current?.scrollTo({ top: 0 });
	};
	const addPage = () => {
		if (ptr.current.id !== null) return;
		setPages((ps) => [...ps, blankPage(assessmentId, problemId, ps.length, page?.paper ?? "blank")]);
		setIdx(pages.length);
		scrollRef.current?.scrollTo({ top: 0 });
	};
	const deletePage = () => {
		if (!page || pages.length < 2 || saving || ptr.current.id !== null) return;
		const note = page.upload ? " Its saved image stays in your answer (remove that with the thumbnail's trash button)." : "";
		if (page.strokes.length && !window.confirm(`Delete page ${idx + 1}?${note}`)) return;
		history.current.clear();
		setPages((ps) => ps.filter((_, i) => i !== idx).map((p, i) => ({ ...p, page: i })));
		setIdx((i) => Math.max(0, Math.min(i, pages.length - 2)));
	};
	const toggleFinger = () => {
		setPref(PREF_FINGER, fingerDraws ? "0" : "1");
		setFingerDraws(!fingerDraws);
	};

	const savePage = async () => {
		const snap = page;
		const at = idx;
		if (!snap || !snap.strokes.length || saving) return;
		setSaving(true);
		setError(null);
		const base = `/api/program/assessments/${encodeURIComponent(assessmentId)}/uploads?problem=${encodeURIComponent(problemId)}`;
		const errorOf = async (r: Response) => ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`;
		try {
			const png = await exportPng(snap);
			if (snap.upload) {
				const r = await fetch(`${base}&file=${encodeURIComponent(snap.upload)}`, { method: "DELETE" });
				if (!r.ok) throw new Error(`couldn't replace the saved page: ${await errorOf(r)}`);
				setPages((ps) => ps.map((p, i) => (i === at ? { ...p, upload: null, dirty: true } : p)));
			}
			const r = await fetch(base, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
			const body = (await r.json().catch(() => ({}))) as { file?: string; error?: string };
			if (!r.ok || !body.file) throw new Error(body.error ?? `HTTP ${r.status}`);
			const file = body.file;
			setPages((ps) => ps.map((p, i) => (i === at ? { ...p, upload: file, dirty: p.strokes !== snap.strokes || p.paper !== snap.paper } : p)));
			onUploaded();
		} catch (err) {
			setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
			onUploaded();
		} finally {
			setSaving(false);
		}
	};

	// keyboard (PC): Ctrl/Cmd+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Escape closes
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (mod && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) redo();
				else undo();
			} else if (mod && e.key.toLowerCase() === "y") {
				e.preventDefault();
				redo();
			} else if (e.key === "Escape") close();
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [undo, redo, close]);

	const saved = !!page?.upload && !page.dirty;
	const status = !page?.strokes.length ? "" : saved ? "In your answer" : page.upload ? "Changed since saved" : "Draft";
	const dispH = Math.round((dispW * PAGE_H) / PAGE_W);

	return (
		<div
			className="fixed inset-0 z-50 flex flex-col bg-muted"
			style={{ paddingTop: "env(safe-area-inset-top)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
			role="dialog"
			aria-modal="true"
			aria-label={`Write ${label}`}
		>
			<div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-2 py-1.5 select-none">
				<Btn label="Close" onClick={close}>
					<XIcon className="size-5" />
				</Btn>
				<span className="mr-1 truncate text-sm font-medium">{label}</span>
				<Sep />
				{(Object.entries(PEN_COLORS) as [keyof typeof PEN_COLORS, string][]).map(([name, c]) => (
					<Btn
						key={name}
						label={`${name[0]!.toUpperCase()}${name.slice(1)} pen`}
						pressed={tool === "pen" && color === c}
						onClick={() => {
							setTool("pen");
							setColor(c);
						}}
					>
						<span className="size-5 rounded-full ring-2 ring-foreground/25" style={{ background: c }} />
					</Btn>
				))}
				<Btn label="Highlighter" pressed={tool === "highlighter"} onClick={() => setTool("highlighter")}>
					<HighlighterIcon className="size-5" />
				</Btn>
				<Btn label="Eraser (whole strokes)" pressed={tool === "eraser"} onClick={() => setTool("eraser")}>
					<EraserIcon className="size-5" />
				</Btn>
				<Sep />
				<Btn label="Undo" disabled={!hist.undo} onClick={undo}>
					<Undo2Icon className="size-5" />
				</Btn>
				<Btn label="Redo" disabled={!hist.redo} onClick={redo}>
					<Redo2Icon className="size-5" />
				</Btn>
				<Btn label="Clear page" disabled={!page?.strokes.length} onClick={() => page && setStrokes([], page.strokes)}>
					<Trash2Icon className="size-5" />
				</Btn>
				<Sep />
				<Btn label="Blank paper" pressed={page?.paper === "blank"} onClick={() => setPaper("blank")}>
					<SquareIcon className="size-5" />
				</Btn>
				<Btn label="Grid paper" pressed={page?.paper === "grid"} onClick={() => setPaper("grid")}>
					<Grid3x3Icon className="size-5" />
				</Btn>
				<Btn label="Lined paper" pressed={page?.paper === "lined"} onClick={() => setPaper("lined")}>
					<AlignJustifyIcon className="size-5" />
				</Btn>
				<Btn label={fingerDraws ? "Fingers draw (tap so fingers scroll instead)" : "Fingers scroll (tap so fingers draw too)"} pressed={fingerDraws} onClick={toggleFinger}>
					<HandIcon className="size-5" />
				</Btn>
				<div className="ml-auto flex items-center gap-1">
					<Btn label="Previous page" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
						<ChevronLeftIcon className="size-5" />
					</Btn>
					<span className="min-w-12 text-center text-sm tabular-nums">
						{idx + 1} / {Math.max(1, pages.length)}
					</span>
					<Btn label="Next page" disabled={idx >= pages.length - 1} onClick={() => goTo(idx + 1)}>
						<ChevronRightIcon className="size-5" />
					</Btn>
					<Btn label="Add page" onClick={addPage}>
						<FilePlusIcon className="size-5" />
					</Btn>
					<Btn label="Delete page" disabled={pages.length < 2 || saving} onClick={deletePage}>
						<FileXIcon className="size-5" />
					</Btn>
					{status && (
						<span className={cn("hidden px-1 text-xs sm:inline", saved ? "text-[var(--st-mastered)]" : "text-muted-foreground")} title={saved ? "The grader sees this page" : "Not in your answer until you save it"}>
							{status}
						</span>
					)}
					<button
						type="button"
						onClick={() => void savePage()}
						disabled={!page?.strokes.length || saving || saved}
						className="flex h-11 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
					>
						{saving ? <Loader2Icon className="size-4 animate-spin" /> : saved ? <CheckIcon className="size-4" /> : <UploadIcon className="size-4" />}
						{saved ? "Saved" : page?.upload ? "Update page" : "Save page"}
					</button>
				</div>
			</div>
			{(error || storageError) && <div className="border-b border-border bg-background px-3 py-1.5 text-sm text-destructive">{error ?? storageError}</div>}
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
				<div className="relative mx-auto my-4 bg-white shadow-md ring-1 ring-black/10" style={{ width: dispW || undefined, height: dispH || undefined }}>
					<canvas ref={baseRef} className="absolute inset-0 size-full" aria-hidden="true" />
					<canvas
						ref={liveRef}
						data-ink-surface=""
						className="absolute inset-0 size-full select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
						style={{ touchAction: relaxTouch && !fingerDraws ? "pan-x pan-y pinch-zoom" : "none", cursor: tool === "eraser" ? "cell" : "crosshair" }}
						role="img"
						aria-label={`${label}, page ${idx + 1}: writing surface`}
					/>
					{!loaded && (
						<div className="absolute inset-0 flex items-center justify-center">
							<Loader2Icon className="size-6 animate-spin text-muted-foreground" />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function Btn({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-accent disabled:opacity-35 disabled:hover:bg-transparent",
				pressed && "bg-accent ring-1 ring-border",
			)}
		>
			{children}
		</button>
	);
}

function Sep() {
	return <span className="mx-0.5 h-6 w-px bg-border" aria-hidden="true" />;
}
