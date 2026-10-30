"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { ArrowLeftIcon, Loader2Icon, PrinterIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent } from "@/components/server-events";
import type { Assessment } from "@/src/core";
import { Equation } from "./equations";

/**
 * A practice sheet as paper: a full-screen white preview (portalled to
 * <body>, so printing drops the app shell — see `.lh-print-root` in
 * globals.css). Page 1: the problems with room to work and a QR code to the
 * sheet in the app (photo grading); page 2: the worked answers.
 */
export function WorksheetPrint({ sheet, lessons, sheetUrl }: { sheet: Assessment; lessons: string[]; sheetUrl: string }) {
	const router = useRouter();
	const [qr, setQr] = useState<string | null>(null);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	useEffect(() => {
		void QRCode.toDataURL(sheetUrl, { margin: 0, width: 200 }).then(setQr, () => setQr(null));
	}, [sheetUrl]);
	// Still being written: refresh when the background task lands.
	useServerEvent("curriculum-changed", () => {
		if (sheet.status === "generating") router.refresh();
	});
	if (!mounted) return null;

	const date = new Date(sheet.createdAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
	const ready = sheet.problems.length > 0 && sheet.status !== "generating" && sheet.status !== "error";

	return createPortal(
		<div className="lh-print-root fixed inset-0 z-[100] overflow-y-auto bg-neutral-200 print:static print:overflow-visible print:bg-white">
			<div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-300 bg-white/90 px-4 py-2 text-sm text-neutral-700 backdrop-blur print:hidden">
				<Link href="/program" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-neutral-100 pointer-coarse:min-h-11">
					<ArrowLeftIcon className="size-4" /> Program
				</Link>
				<span className="ml-2 min-w-0 truncate text-neutral-500">{ready ? "The answers print on page 2 — fold it away." : ""}</span>
				<button
					type="button"
					disabled={!ready}
					onClick={() => window.print()}
					className="ml-auto flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-white hover:bg-neutral-700 disabled:opacity-40 pointer-coarse:min-h-11"
				>
					<PrinterIcon className="size-4" /> Print
				</button>
			</div>

			{!ready ? (
				<div className="mx-auto mt-16 max-w-md rounded-xl bg-white p-8 text-center text-sm text-neutral-600 shadow">
					{sheet.status === "error" ? (
						<p className="text-red-700">The sheet could not be written: {sheet.error ?? "unknown error"}</p>
					) : (
						<p className="flex items-center justify-center gap-2">
							<Loader2Icon className="size-4 animate-spin" /> Writing your practice sheet… (about a minute)
						</p>
					)}
				</div>
			) : (
				<div className="lh-paper mx-auto my-6 max-w-[8.5in] space-y-6 print:my-0 print:max-w-none print:space-y-0">
					<section className="lh-page bg-white p-[0.6in] shadow print:p-0 print:shadow-none">
						<header className="flex items-start gap-4 border-b border-neutral-300 pb-3">
							<div className="min-w-0 flex-1">
								<h1 className="text-xl font-semibold">{sheet.title}</h1>
								<div className="mt-0.5 text-xs text-neutral-600">
									{date} · about {sheet.minutes ?? 15} min · calculator OK
								</div>
								<div className="mt-1 text-[11px] leading-snug text-neutral-500">{lessons.join(" · ")}</div>
							</div>
							{qr && (
								<figure className="shrink-0 text-center">
									{/* eslint-disable-next-line @next/next/no-img-element -- a data: URL */}
									<img src={qr} alt="QR code to this sheet in the app" className="size-[0.95in]" />
									<figcaption className="mt-1 w-[1.1in] text-[9px] leading-tight text-neutral-500">Scan to photograph your work for grading</figcaption>
								</figure>
							)}
						</header>
						<ol className="mt-4 space-y-5">
							{sheet.problems.map((p, i) => (
								<li key={p.id} className="lh-problem break-inside-avoid">
									<div className="flex gap-2">
										<span className="font-semibold">{i + 1}.</span>
										<div className="min-w-0 flex-1 text-[14px] leading-relaxed">
											<MessageResponse className="h-auto!">{p.prompt}</MessageResponse>
											{p.equations?.length ? (
												<div className="mt-1 flex flex-wrap gap-x-6 text-neutral-700">
													{p.equations.map((eq, k) => (
														<Equation key={k} tex={eq} className="text-[13px] [&_.katex-display]:my-0.5" />
													))}
												</div>
											) : null}
											<div className="mt-2 h-[1.5in] rounded border border-dashed border-neutral-300" aria-hidden />
										</div>
									</div>
								</li>
							))}
						</ol>
					</section>

					<section className="lh-page lh-answers bg-white p-[0.6in] shadow print:p-0 print:shadow-none">
						<h2 className="border-b border-neutral-300 pb-2 text-lg font-semibold">Answers · {sheet.title}</h2>
						<ol className="mt-3 space-y-4">
							{sheet.problems.map((p, i) => (
								<li key={p.id} className="break-inside-avoid text-[12.5px] leading-relaxed">
									<div className="flex gap-2">
										<span className="font-semibold">{i + 1}.</span>
										<div className="min-w-0 flex-1">
											<MessageResponse className="h-auto!">{p.solution}</MessageResponse>
										</div>
									</div>
								</li>
							))}
						</ol>
					</section>
				</div>
			)}
		</div>,
		document.body,
	);
}
