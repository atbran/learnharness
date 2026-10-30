"use client";

import { useMemo, useState } from "react";
import katex from "katex";
import { ChevronDownIcon, SigmaIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One display-mode equation (LaTeX). */
export function Equation({ tex, className }: { tex: string; className?: string }) {
	const html = useMemo(() => {
		try {
			return katex.renderToString(tex, { displayMode: true, throwOnError: false });
		} catch {
			return null;
		}
	}, [tex]);
	return html ? <div className={cn("text-[15px]", className)} dangerouslySetInnerHTML={{ __html: html }} /> : <code className="text-xs">{tex}</code>;
}

/** The equations a question needs, under its prompt. */
export function QuestionEquations({ equations }: { equations?: string[] }) {
	if (!equations?.length) return null;
	return (
		<div className="mt-3 rounded-lg border border-dashed border-border bg-background/50 px-3 py-2" data-testid="question-equations">
			<div className="text-[11px] uppercase tracking-wider text-muted-foreground">You&apos;ll need</div>
			<div className="space-y-1 overflow-x-auto">
				{equations.map((eq, i) => (
					<Equation key={i} tex={eq} className="[&_.katex-display]:my-1" />
				))}
			</div>
		</div>
	);
}

export interface EquationGroup {
	title: string;
	equations: string[];
}

/** A collapsible formula sheet: the key equations of the lesson(s) the
 *  quiz or problem set covers. */
export function EquationSheet({ groups }: { groups: EquationGroup[] }) {
	const [open, setOpen] = useState(false);
	const shown = groups.filter((g) => g.equations.length > 0);
	if (shown.length === 0) return null;
	const count = shown.reduce((n, g) => n + g.equations.length, 0);
	return (
		<section className="rounded-xl border border-border bg-card" data-testid="equation-sheet">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-accent pointer-coarse:min-h-11"
			>
				<SigmaIcon className="size-4 text-muted-foreground" />
				<span className="font-medium">Equation sheet</span>
				<span className="text-xs text-muted-foreground">{count} equations</span>
				<ChevronDownIcon className={cn("ml-auto size-4 transition-transform", open && "rotate-180")} />
			</button>
			{open && (
				<div className="space-y-4 border-t border-border px-4 py-3">
					{shown.map((g, i) => (
						<div key={i}>
							{shown.length > 1 && <div className="mb-1 text-xs text-muted-foreground">{g.title}</div>}
							<div className="space-y-1 overflow-x-auto">
								{g.equations.map((eq, k) => (
									<Equation key={k} tex={eq} className="[&_.katex-display]:my-1" />
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
