"use client";

import { Equation } from "./equations";
import { PaperView } from "./paper-view";

/** A unit's equation sheet as paper (PaperView): each lesson's key
 *  equations under its title, in two columns, sized for one page. */
export function EquationSheet({
	course,
	unit,
	lessons,
}: {
	course: { id: string; code: string; title: string };
	unit: { title: string };
	lessons: { id: string; title: string; equations: string[] }[];
}) {
	const withEquations = lessons.filter((l) => l.equations.length > 0);
	return (
		<PaperView back={{ href: `/program/course/${course.id}`, label: course.code }} ready={withEquations.length > 0}>
			<div className="mx-auto my-6 max-w-[8.5in] print:my-0 print:max-w-none">
				<section className="lh-page bg-white p-[0.5in] shadow print:p-0 print:shadow-none">
					<header className="border-b border-neutral-300 pb-2">
						<h1 className="text-lg font-semibold">
							{course.code} · {unit.title}
						</h1>
						<div className="text-xs text-neutral-600">Equation sheet · {course.title}</div>
					</header>
					{withEquations.length === 0 ? (
						<p className="mt-4 text-sm text-neutral-600">This unit's lessons list no key equations.</p>
					) : (
						<div className="mt-3 columns-2 gap-6 max-sm:columns-1 print:columns-2">
							{withEquations.map((l) => (
								<div key={l.id} className="mb-3 break-inside-avoid">
									<h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{l.title}</h2>
									{l.equations.map((eq, i) => (
										<Equation key={i} tex={eq} className="overflow-x-auto text-[13px] [&_.katex-display]:my-1" />
									))}
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</PaperView>
	);
}
