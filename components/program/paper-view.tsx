"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeftIcon, PrinterIcon } from "lucide-react";

/**
 * Printable paper: a full-screen white preview portalled to <body>, so
 * printing drops the app shell (`.lh-print-root` in globals.css), with a
 * screen-only toolbar (back, a note, Print). Children are the pages: each
 * `.lh-page` is a white sheet on screen; `.lh-answers` starts a new page.
 */
export function PaperView({ back, note, ready, children }: { back: { href: string; label: string }; note?: string; ready: boolean; children: ReactNode }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return null;
	return createPortal(
		<div className="lh-print-root fixed inset-0 z-[100] overflow-y-auto bg-neutral-200 print:static print:overflow-visible print:bg-white">
			<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-300 bg-white/90 px-4 py-2 text-sm text-neutral-700 backdrop-blur print:hidden">
				<Link href={back.href} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-neutral-100 pointer-coarse:min-h-11">
					<ArrowLeftIcon className="size-4" /> {back.label}
				</Link>
				<span className="ml-2 min-w-0 truncate text-neutral-500">{ready ? (note ?? "") : ""}</span>
				<button
					type="button"
					disabled={!ready}
					onClick={() => window.print()}
					className="ml-auto flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-700 disabled:opacity-40 pointer-coarse:min-h-11"
				>
					<PrinterIcon className="size-4" /> Print
				</button>
			</div>
			{children}
		</div>,
		document.body,
	);
}
