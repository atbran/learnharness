"use client";

/**
 * Math input: a "∑ Math" button that opens a MathLive field (WYSIWYG —
 * fractions stack, exponents raise) with its on-screen keyboard, and hands
 * the formula back as LaTeX. Callers splice it into their own text as
 * `$…$` / `$$…$$` (lib/math-insert.ts), so answers stay plain markdown the
 * graders read.
 *
 * MathLive touches `window` and registers custom elements, so it is loaded
 * with a client-side `import()` the first time a panel opens — never during
 * SSR. Its KaTeX fonts are served from /public/mathlive/fonts (copied from
 * node_modules/mathlive/fonts) and its sounds are off: no CDN fetches.
 *
 * The panel is a sheet fixed to the top or bottom of the viewport — the side
 * AWAY from the input it inserts into (a phone always gets the bottom; the
 * page scrolls the input above it) — and the virtual keyboard renders
 * inside the sheet (not MathLive's default body-level keyboard), so neither
 * covers that input (iPad portrait included).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SigmaIcon } from "lucide-react";
import type { MathfieldElement, VirtualKeyboardLayout } from "mathlive";
import { cn } from "@/lib/utils";
import { spliceMath } from "@/lib/math-insert";
import { EDIT_TEXT_EVENT, type EditTextDetail } from "@/components/path-input";

type MathLive = typeof import("mathlive");

const CALCULUS: VirtualKeyboardLayout = {
	label: "∫ ∂ Σ",
	tooltip: "Calculus",
	rows: [
		["\\int", "\\int_{#?}^{#?}#0\\,\\mathrm{d}x", "\\iint", "\\oint", "\\frac{\\mathrm{d}}{\\mathrm{d}x}", "\\frac{\\mathrm{d}#?}{\\mathrm{d}#?}", "\\frac{\\partial}{\\partial x}", "\\frac{\\partial #?}{\\partial #?}", "\\partial", "\\mathrm{d}"],
		["\\sum_{#?}^{#?}", "\\prod_{#?}^{#?}", "\\lim_{#?\\to#?}", "\\infty", "\\to", "\\nabla", "\\Delta", "\\dot{#0}", "\\ddot{#0}", "#@^{\\prime}"],
		["\\pm", "\\approx", "\\propto", "\\ne", "\\le", "\\ge", "\\times", "\\cdot", "\\sqrt{#0}", "\\frac{#0}{#?}"],
		["[left]", "[right]", "#@^{#?}", "#@_{#?}", "(", ")", "=", "[separator]", "[backspace]", "[action]"],
	],
};

const VECTORS: VirtualKeyboardLayout = {
	label: "<b>v</b> [ ]",
	tooltip: "Vectors & matrices",
	rows: [
		["\\vec{#0}", "\\hat{#0}", "\\mathbf{#0}", "\\left|#0\\right|", "\\left\\Vert #0\\right\\Vert", "\\cdot", "\\times", "\\otimes", "\\perp", "\\parallel"],
		["\\nabla", "\\nabla\\cdot", "\\nabla\\times", "\\nabla^2", "\\hat{x}", "\\hat{y}", "\\hat{z}", "\\langle #0|", "|#0\\rangle", "\\langle #?|#?\\rangle"],
		[
			"\\begin{pmatrix}#?\\\\#?\\end{pmatrix}",
			"\\begin{pmatrix}#?\\\\#?\\\\#?\\end{pmatrix}",
			"\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}",
			"\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}",
			"\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}",
			"#@^{\\mathsf{T}}",
			"#@^{-1}",
			"#@^{\\dagger}",
			"\\det",
			"\\operatorname{tr}",
		],
		["[left]", "[right]", "#@^{#?}", "#@_{#?}", "(", ")", "=", "[separator]", "[backspace]", "[action]"],
	],
};

const FUNCTIONS: VirtualKeyboardLayout = {
	label: "f(x)",
	tooltip: "Functions",
	rows: [
		["\\sin", "\\cos", "\\tan", "\\arcsin", "\\arccos", "\\arctan", "\\sinh", "\\cosh", "\\tanh", "\\sec"],
		["\\ln", "\\log", "\\log_{#?}", "\\exp", "\\mathrm{e}^{#?}", "10^{#?}", "\\sqrt{#0}", "\\sqrt[#?]{#0}", "\\left|#0\\right|", "#@!"],
		["f(#?)", "g(#?)", "f'(#?)", "#@^{-1}", "\\binom{#?}{#?}", "\\max", "\\min", "\\hbar", "\\mathrm{#0}", "\\text{#0}"],
		["[left]", "[right]", "#@^{#?}", "#@_{#?}", "(", ")", "=", "[separator]", "[backspace]", "[action]"],
	],
};

let loading: Promise<MathLive> | null = null;
/** Load and configure MathLive once (client only). */
function loadMathLive(): Promise<MathLive> {
	loading ??= import("mathlive")
		.then((ml) => {
			// An absolute URL: a relative one makes MathLive HEAD-fetch its own
			// script to resolve it.
			ml.MathfieldElement.fontsDirectory = new URL("/mathlive/fonts", window.location.origin).href;
			ml.MathfieldElement.soundsDirectory = null;
			ml.MathfieldElement.keypressSound = null;
			ml.MathfieldElement.plonkSound = null;
			ml.MathfieldElement.keypressVibration = false;
			window.mathVirtualKeyboard.layouts = ["numeric", CALCULUS, "greek", VECTORS, FUNCTIONS, "alphabetic"];
			return ml;
		})
		.catch((error: unknown) => {
			loading = null;
			throw error;
		});
	return loading;
}

/** Strip MathLive's unfilled `\placeholder{}` boxes from expanded LaTeX. */
function cleanLatex(latex: string): string {
	return latex
		.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, "")
		.replace(/[\^_]\{\}/g, "") // a limit/exponent left empty
		.trim();
}

/** The nearest scrolling ancestor (the page's own scroll area). */
function scrollParent(el: HTMLElement): HTMLElement {
	for (let p = el.parentElement; p; p = p.parentElement) {
		const y = getComputedStyle(p).overflowY;
		if (y === "auto" || y === "scroll") return p;
	}
	return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function isTouch(): boolean {
	return window.matchMedia("(pointer: coarse)").matches;
}

/** iPhone portrait or landscape: the sheet always docks at the bottom,
 *  where the thumbs are, and the page scrolls the input above it. */
function isPhone(): boolean {
	return window.matchMedia("(max-width: 639px), (max-height: 500px)").matches;
}

export interface MathButtonProps {
	/** Receives the formula as LaTeX (no `$` delimiters). */
	onInsert: (latex: string, display: boolean) => void;
	/** The input the formula goes into — the sheet opens on the other side
	 *  of the viewport so it never covers it. Defaults to the button. */
	target?: () => HTMLElement | null;
	/** Offer the inline / display ($$…$$) choice. */
	allowDisplay?: boolean;
	/** Reject a formula with a message instead of inserting it. */
	validate?: (latex: string) => string | null;
	/** Icon-only square button (the chat composer row). */
	compact?: boolean;
	disabled?: boolean;
	className?: string;
	hint?: ReactNode;
}

export function MathButton({ onInsert, target, allowDisplay, validate, compact, disabled, className, hint }: MathButtonProps) {
	const [open, setOpen] = useState(false);
	const [atTop, setAtTop] = useState(false);
	const button = useRef<HTMLButtonElement>(null);

	const targetEl = useCallback(() => target?.() ?? button.current, [target]);

	return (
		<>
			<button
				ref={button}
				type="button"
				disabled={disabled}
				aria-label="Insert math"
				title="Insert math (fractions, integrals, Greek…)"
				aria-expanded={open}
				onClick={() => {
					const el = targetEl();
					if (el) {
						const r = el.getBoundingClientRect();
						setAtTop(!isPhone() && r.top + r.height / 2 > window.innerHeight / 2);
					}
					setOpen((v) => !v);
				}}
				className={cn(
					compact
						? "flex size-10 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						: "flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:min-h-11",
					open && "bg-accent text-foreground",
					className,
				)}
			>
				<SigmaIcon className={compact ? "size-5" : "size-4"} />
				{!compact && "Math"}
			</button>
			{open &&
				createPortal(
					<MathSheet
						atTop={atTop}
						target={targetEl}
						allowDisplay={allowDisplay}
						validate={validate}
						hint={hint}
						onClose={() => setOpen(false)}
						onInsert={(latex, display) => {
							setOpen(false);
							onInsert(latex, display);
						}}
					/>,
					document.body,
				)}
		</>
	);
}

function MathSheet({
	atTop,
	target,
	allowDisplay,
	validate,
	hint,
	onClose,
	onInsert,
}: {
	atTop: boolean;
	target: () => HTMLElement | null;
	allowDisplay?: boolean;
	validate?: (latex: string) => string | null;
	hint?: ReactNode;
	onClose: () => void;
	onInsert: (latex: string, display: boolean) => void;
}) {
	const sheet = useRef<HTMLDivElement>(null);
	const fieldHost = useRef<HTMLDivElement>(null);
	const kbHost = useRef<HTMLDivElement>(null);
	const field = useRef<MathfieldElement | null>(null);
	const [kbHeight, setKbHeight] = useState(0);
	const [display, setDisplay] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const latest = useRef({ display, validate, onInsert, onClose });
	useLayoutEffect(() => {
		latest.current = { display, validate, onInsert, onClose };
	});

	const commit = useCallback(() => {
		const mf = field.current;
		if (!mf) return;
		const latex = cleanLatex(mf.getValue("latex-expanded"));
		if (!latex) return latest.current.onClose();
		const problem = latest.current.validate?.(latex) ?? null;
		if (problem) {
			setError(problem);
			mf.focus();
			return;
		}
		latest.current.onInsert(latex, latest.current.display);
	}, []);

	useEffect(() => {
		let cancelled = false;
		let mf: MathfieldElement | null = null;
		const onGeometry = () => {
			const kb = window.mathVirtualKeyboard;
			setKbHeight(kb.visible ? Math.ceil(kb.boundingRect.height) : 0);
		};
		// Keys typed in the field never reach the page (window-level
		// shortcuts, the practice dock's Enter-submits-from-anywhere) — so
		// Escape is handled here, not by a React handler further up.
		const onKey = (e: KeyboardEvent) => e.stopPropagation();
		// Capture phase, before MathLive sees it: its own Escape would open
		// the raw-LaTeX mode. Outside that mode Escape closes the sheet.
		const onEscape = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || mf?.mode === "latex") return;
			e.preventDefault();
			e.stopPropagation();
			latest.current.onClose();
		};
		const onInput = (e: Event) => {
			setError(null);
			if ((e as InputEvent).inputType === "insertLineBreak") commit();
		};
		loadMathLive()
			.then((ml) => {
				if (cancelled || !fieldHost.current || !kbHost.current) return;
				const kb = window.mathVirtualKeyboard;
				kb.container = kbHost.current;
				kb.addEventListener("geometrychange", onGeometry);
				mf = new ml.MathfieldElement();
				mf.mathVirtualKeyboardPolicy = "auto";
				mf.popoverPolicy = "off";
				mf.addEventListener("input", onInput);
				mf.addEventListener("keydown", onKey);
				mf.addEventListener("keydown", onEscape, true);
				fieldHost.current.appendChild(mf);
				field.current = mf;
				mf.focus();
				// Touch devices: MathLive's keyboard shows on focus ("auto").
				// Desktop: the field's own keyboard toggle shows it on demand.
				if (isTouch()) kb.show();
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
			field.current = null;
			const kb = typeof window !== "undefined" ? window.mathVirtualKeyboard : undefined;
			if (kb) {
				kb.removeEventListener("geometrychange", onGeometry);
				kb.hide({ animate: false });
				// Park the singleton keyboard back on <body> (hidden) so the next
				// sheet re-homes it cleanly.
				kb.container = document.body;
			}
			mf?.removeEventListener("input", onInput);
			mf?.removeEventListener("keydown", onKey);
			mf?.removeEventListener("keydown", onEscape, true);
			mf?.remove();
		};
	}, [commit]);

	// Keep the target input clear of the sheet as the keyboard opens/closes:
	// scroll its container, padding the end of a short page so it CAN scroll
	// (undone when the sheet closes).
	const padded = useRef<{ el: HTMLElement; original: string } | null>(null);
	useLayoutEffect(() => {
		const el = target();
		const s = sheet.current;
		if (!el || !s) return;
		const t = el.getBoundingClientRect();
		const r = s.getBoundingClientRect();
		// The free band the target must sit in, beside the sheet.
		const gap = 8;
		const lo = atTop ? r.bottom + gap : gap;
		const hi = atTop ? window.innerHeight - gap : r.top - gap;
		// > 0: scroll the page down by that much; < 0: up. A target taller
		// than the band keeps its top edge visible.
		const by = t.top < lo || t.bottom - t.top > hi - lo ? t.top - lo : t.bottom > hi ? t.bottom - hi : 0;
		if (Math.abs(by) < 1) return;
		const scroller = scrollParent(el);
		const room = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
		if (by > room) {
			padded.current ??= { el: scroller, original: scroller.style.paddingBottom };
			const current = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
			scroller.style.paddingBottom = `${current + by - room}px`;
		}
		scroller.scrollTop += by;
	}, [kbHeight, atTop, target, error]);
	useEffect(
		() => () => {
			if (padded.current) padded.current.el.style.paddingBottom = padded.current.original;
		},
		[],
	);

	return (
		<div
			ref={sheet}
			role="dialog"
			aria-label="Math input"
			data-testid="math-sheet"
			// Landscape phone: the side insets keep keys out from under the notch.
			className={cn("fixed inset-x-0 z-[70] flex justify-center sm:pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1rem,env(safe-area-inset-left))]", atTop ? "top-0 sm:pt-2" : "bottom-0 sm:pb-2")}
			style={atTop ? { paddingTop: "env(safe-area-inset-top)" } : { paddingBottom: "env(safe-area-inset-bottom)" }}
			onMouseDown={(e) => {
				// A press anywhere else on the sheet (padding, buttons) must not
				// blur the field: MathLive hides its keyboard on blur. Clicks
				// still fire.
				if (!(e.target instanceof Element && e.target.closest("math-field"))) e.preventDefault();
			}}
			onKeyDown={(e) => {
				// The sheet's keys belong to the math field, never to the page's
				// shortcuts (React tree: the portal still bubbles to the caller).
				e.stopPropagation();
				if (e.key === "Escape" && field.current?.mode !== "latex") onClose();
			}}
		>
			<div className="w-full max-w-4xl overflow-hidden border-border bg-card shadow-2xl shadow-black/60 sm:rounded-xl sm:border max-sm:border-y">
				<div className="flex flex-wrap items-center gap-2 p-2">
					<div
						ref={fieldHost}
						className="lh-math-field min-h-12 min-w-0 flex-1 basis-64 rounded-lg border border-border bg-background px-2 py-1 text-[22px]"
					>
						{failed && <span className="text-sm text-destructive">The math editor failed to load.</span>}
					</div>
					<div className="flex items-center gap-2">
						{allowDisplay && (
							<button
								type="button"
								aria-pressed={display}
								onClick={() => {
									setDisplay((v) => !v);
									field.current?.focus();
								}}
								title="Display: the formula gets its own centered line ($$…$$)"
								className={cn(
									"rounded-lg border border-border px-3 py-1.5 text-xs pointer-coarse:min-h-11",
									display ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent",
								)}
							>
								{display ? "Own line" : "Inline"}
							</button>
						)}
						<button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent pointer-coarse:min-h-11">
							Cancel
						</button>
						<button type="button" onClick={commit} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 pointer-coarse:min-h-11">
							Insert
						</button>
					</div>
				</div>
				{(error || hint) && <div className={cn("px-3 pb-2 text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ?? hint}</div>}
				<div ref={kbHost} className="lh-math-keyboard relative" style={{ height: kbHeight }} />
			</div>
			<style>{SHEET_CSS}</style>
		</div>
	);
}

/** Dark skin from the app tokens (app/globals.css): MathLive's own dark
 *  palette only applies under prefers-color-scheme, and the app is always
 *  dark. */
const SHEET_CSS = `
.lh-math-field math-field {
	display: block;
	width: 100%;
	border: 0;
	background: transparent;
	color: var(--foreground);
	--caret-color: var(--foreground);
	--selection-background-color: #3a4a5c;
	--selection-color: var(--foreground);
	--contains-highlight-background-color: #262626;
	--placeholder-color: var(--muted-foreground);
	--smart-fence-color: var(--muted-foreground);
}
/* The app's no-ring law: the host's border carries focus instead. */
.lh-math-field math-field,
.lh-math-field math-field:focus,
.lh-math-field math-field:focus-within { outline: none; }
.lh-math-field:focus-within { border-color: var(--muted-foreground); }
.lh-math-field math-field::part(menu-toggle) { color: var(--muted-foreground); }
.lh-math-field math-field::part(virtual-keyboard-toggle) { color: var(--muted-foreground); }
.lh-math-keyboard {
	/* No --keyboard-zindex override: MathLive drops a pressed key to
	   z-index (that - 5), so a small value sends it behind its row and the
	   release misses the key. The sheet's own z-index contains it. */
	--keyboard-background: var(--card);
	--keyboard-border: var(--border);
	--keyboard-accent-color: #4a4a4a;
	--keyboard-toolbar-text: var(--muted-foreground);
	--keyboard-toolbar-text-active: var(--foreground);
	--keyboard-toolbar-background-hover: var(--accent);
	--keyboard-horizontal-rule: 1px solid var(--border);
	--keycap-background: var(--accent);
	--keycap-background-hover: #333333;
	--keycap-border: transparent;
	--keycap-border-bottom: #0e0e0e;
	--keycap-text: var(--foreground);
	--keycap-text-active: var(--foreground);
	--keycap-shift-text: var(--muted-foreground);
	--keycap-secondary-background: #3a3a3a;
	--keycap-secondary-background-hover: #444444;
	--keycap-secondary-text: var(--foreground);
	--keycap-secondary-border: transparent;
	--keycap-secondary-border-bottom: #0e0e0e;
	--keycap-primary-background: var(--primary);
	--keycap-primary-text: var(--primary-foreground);
	--keycap-primary-background-hover: #ffffff;
	--variant-panel-background: var(--card);
	--variant-keycap-text: var(--foreground);
	/* 56px keys on a portrait iPad, ~44px in landscape / short windows. */
	--keycap-height: clamp(40px, 5.4vh, 56px);
}
/* Phone: MathLive sizes a key at 10% of the keyboard, but the numeric
   layer is ~11 keys wide (separators included), so its right column fell
   off a 390px screen. 9% fits every layer. Landscape keeps the sheet
   short enough to leave the answer box visible above it. */
@media (max-width: 639px), (max-height: 500px) {
	.lh-math-keyboard { --keycap-width: min(62px, 9cqw); }
}
/* Its toolbar (6 layer tabs + undo/redo/paste at 46px each) is 414px:
   narrower tabs keep the paste button on a 390px screen. */
@media (max-width: 639px) {
	.lh-math-keyboard .MLK__toolbar > div > div { min-width: 36px; margin-left: 1px; margin-right: 1px; }
}
@media (max-height: 500px) {
	.lh-math-keyboard { --keycap-height: 34px; --keycap-gap: 4px; }
	.lh-math-keyboard .MLK__toolbar > div > div,
	.lh-math-keyboard .MLK__toolbar > div > div.selected { min-height: 30px; padding-top: 0; padding-bottom: 0; margin-bottom: 0; }
}
`;

/** Splice a formula into a textarea/input's text at its caret and put the
 *  caret after it. Desktop gets focus back; touch does not (focusing a text
 *  box on iPad pops the system keyboard over the page). */
export function insertMathIntoField(
	el: HTMLTextAreaElement | HTMLInputElement | null,
	value: string,
	setValue: (v: string) => void,
	latex: string,
	display = false,
) {
	const start = el?.selectionStart ?? value.length;
	const end = el?.selectionEnd ?? start;
	const next = spliceMath(value, start, end, latex, display);
	if (!next) return;
	setValue(next.value);
	if (!el) return;
	requestAnimationFrame(() => {
		if (!isTouch()) el.focus();
		el.setSelectionRange(next.caret, next.caret);
	});
}

/** Splice a formula into a PathInput (the chat composer, the practice
 *  dock's thinking field) at its remembered caret, as inline `$…$`. */
export function insertMathIntoPathInput(root: HTMLElement | null, latex: string) {
	const detail: EditTextDetail = {
		edit: (value, start, end) => spliceMath(value, start, end, latex),
		focus: !isTouch(),
	};
	root?.dispatchEvent(new CustomEvent(EDIT_TEXT_EVENT, { detail }));
}
