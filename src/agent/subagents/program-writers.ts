/**
 * The physics program's background writers and graders — single-submit
 * agents (runSubmitAgent): quick checks (cheap), problem sets / exams /
 * placement tests (strong, with the textbook tools so real end-of-chapter
 * exercises can be cited and adapted), short-answer and full-assessment
 * grading (vision: photographed handwritten work rides as images), and
 * spoken audio-guide scripts (cheap). Everything they produce is cached by
 * the caller, so each artifact costs tokens once.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { runSubmitAgent } from "./submit-agent.ts";
import type { AssessmentKind, AssessmentProblem, CheckQuestion, Lesson, ProblemGrade } from "../../core/contracts/curriculum.ts";

export interface WriterDeps {
	engine: PiEngine | undefined;
	signal?: AbortSignal;
	/** Book tools (book_lookup/search/read) when textbooks are ingested. */
	bookTools?: Record<string, AgentTool<any>>;
	onUsage?: (usage: Usage, model: string) => void;
}

const LEARNER =
	"The learner is an organic chemist (chemistry degree, p-chem long ago) working through a self-study physics program toward first-year-PhD level. " +
	"Their goal is genuine understanding — to be a well-rounded scientist who grasps WHY things are true and can use the ideas to understand how the world works — with fluent (not drilled) use of equations and calculation. " +
	"Be rigorous and precise; use standard physics notation; math in $…$ (inline) and $$…$$ (display).";

/** The program's assessment philosophy (learner directive): understanding
 *  first, calculation as a fluent tool, never a problem-drill grind.
 *  Physics: calculation/practice is 20–50% of the work. Math courses are
 *  the exception — there, fluent technique IS the understanding. */
const UNDERSTANDING_FIRST =
	"Assess understanding first: physical meaning of equations, why a result holds, limiting cases and sanity checks, order-of-magnitude estimates, " +
	"predicting what happens in a real situation, and connecting to everyday phenomena or chemistry (e.g. what entropy and enthalpy each mean for a reaction's free energy, not twenty ΔG plug-ins). " +
	"Calculations are still required — use equations and get numbers — but as tools in service of insight, not as mechanical drills or algebra marathons.";

export function calculationShare(track: string): string {
	return track === "math"
		? "This is a MATH course: technique matters, so about 60% of the work is computation (still with a 'what does this mean / when does it apply' angle), 40% conceptual."
		: "This is a physics course: about 30% (never more than half) of the work is calculation; the rest is conceptual — explain, predict, estimate, interpret.";
}

function step(deps: WriterDeps) {
	return (usage: Usage, model: string) => deps.onUsage?.(usage, model);
}

function lessonBlock(l: Pick<Lesson, "id" | "title" | "objectives" | "keyEquations" | "readings">): string {
	return [
		`Lesson ${l.id}: ${l.title}`,
		...l.objectives.map((o) => `  - objective: ${o}`),
		...(l.keyEquations.length ? [`  key equations: ${l.keyEquations.join(" ; ")}`] : []),
		...(l.readings.length ? [`  readings: ${l.readings.map((r) => `${r.bookId} ${r.ref} ${r.title}`).join(" | ")}`] : []),
	].join("\n");
}

// ─── Quick checks ───────────────────────────────────────────────────────────

const equationsField = Type.Optional(
	Type.Array(Type.String(), {
		maxItems: 4,
		description:
			"LaTeX (no $) of the equations this question/problem needs, shown to the learner with it. Omit any equation that is, or trivially gives, the answer (e.g. when the question asks to state/derive/choose it).",
	}),
);

const checkSchema = Type.Object({
	questions: Type.Array(
		Type.Union([
			Type.Object({
				kind: Type.Literal("mc"),
				prompt: Type.String(),
				options: Type.Array(Type.String(), { minItems: 3, maxItems: 5 }),
				answer: Type.Integer({ minimum: 0, description: "0-based index of the correct option" }),
				explanation: Type.String(),
				equations: equationsField,
			}),
			Type.Object({
				kind: Type.Literal("numeric"),
				prompt: Type.String({ description: "Must state units/precision expected; answer is a single number." }),
				answer: Type.Number(),
				tolerance: Type.Number({ minimum: 0.001, maximum: 0.2, description: "Relative tolerance, e.g. 0.02" }),
				unit: Type.Optional(Type.String()),
				explanation: Type.String(),
				equations: equationsField,
			}),
			Type.Object({
				kind: Type.Literal("short"),
				prompt: Type.String(),
				rubric: Type.String({ description: "What a full-credit answer must contain." }),
				modelAnswer: Type.String(),
				equations: equationsField,
			}),
		]),
		{ minItems: 4, maxItems: 6 },
	),
});

export async function writeQuickCheck(lesson: Lesson, context: string, track: string, deps: WriterDeps): Promise<CheckQuestion[]> {
	const out = await runSubmitAgent<{ questions: CheckQuestion[] }>({
		role: "checkWriter",
		toolName: "submit_check",
		toolDescription: "Submit the quick check (5 questions).",
		parameters: checkSchema,
		fill: (x) => x,
		systemPrompt:
			`You write short mastery checks for a physics/math self-study program. ${LEARNER}\n\n` +
			`${UNDERSTANDING_FIRST} ${calculationShare(track)}\n\n` +
			"Write exactly 5 questions that together test every objective of the lesson: at least 2 conceptual multiple-choice (plausible distractors built from real misconceptions), " +
			"1–2 numeric (a quick, physically meaningful calculation or estimate, single-number answer, units stated in the prompt), and 1 short-answer (explain why something happens, in the learner's own words). " +
			"Questions test understanding, not trivia or recall of notation. Each explanation teaches the key idea in 1–3 sentences. " +
			"For each question, list in `equations` the equation(s) the learner needs (prefer the lesson's key equations verbatim); leave it out when the equation would give the answer away. " +
				"Double-check every answer and numeric value before submitting.",
		prompt: `${context}\n\n${lessonBlock(lesson)}\n\nWrite the quick check and call submit_check.`,
		engine: deps.engine,
		signal: deps.signal,
		onStep: step(deps),
		neverSubmitted: "the check writer never submitted",
		validate: (v) =>
			v.questions.some((q) => q.kind === "mc" && (q.answer < 0 || q.answer >= q.options.length))
				? "an mc answer index is out of range of its options"
				: null,
	});
	return out.questions;
}

// ─── Unit diagnostics (test out) ────────────────────────────────────────────

const diagnosticSchema = Type.Object({
	questions: Type.Array(
		Type.Union([
			Type.Object({
				lessonId: Type.String(),
				kind: Type.Literal("mc"),
				prompt: Type.String(),
				options: Type.Array(Type.String(), { minItems: 3, maxItems: 5 }),
				answer: Type.Integer({ minimum: 0, description: "0-based index of the correct option" }),
				explanation: Type.String(),
				equations: equationsField,
			}),
			Type.Object({
				lessonId: Type.String(),
				kind: Type.Literal("numeric"),
				prompt: Type.String({ description: "Must state units/precision expected; answer is a single number." }),
				answer: Type.Number(),
				tolerance: Type.Number({ minimum: 0.001, maximum: 0.2, description: "Relative tolerance, e.g. 0.02" }),
				unit: Type.Optional(Type.String()),
				explanation: Type.String(),
				equations: equationsField,
			}),
		]),
	),
});

export type DiagnosticQuestion = Extract<CheckQuestion, { kind: "mc" | "numeric" }> & { lessonId: string };

/** A unit's test-out diagnostic: exactly two auto-graded questions per
 *  lesson, distinct from the lesson's own quick check (its prompts are
 *  passed in to avoid). */
export async function writeUnitDiagnostic(
	unit: { id: string; title: string; summary: string },
	lessons: { lesson: Lesson; avoid: string[] }[],
	context: string,
	track: string,
	deps: WriterDeps,
): Promise<DiagnosticQuestion[]> {
	const ids = new Set(lessons.map((l) => l.lesson.id));
	const out = await runSubmitAgent<{ questions: DiagnosticQuestion[] }>({
		role: "checkWriter",
		toolName: "submit_diagnostic",
		toolDescription: "Submit the diagnostic: exactly 2 questions per lesson.",
		parameters: diagnosticSchema,
		fill: (x) => x,
		systemPrompt:
			`You write a TEST-OUT DIAGNOSTIC for one unit of a physics/math self-study program. ${LEARNER} The learner has seen this material before (rusty) and wants to skip what they still command.

` +
			`${calculationShare(track)}

` +
			"Write exactly 2 questions per lesson, tagged with its lessonId, together covering the lesson's objectives: one quick conceptual multiple-choice (distractors built from real misconceptions) and one that applies the core technique (numeric with a single-number answer and units stated in the prompt, or a multiple-choice on the result). " +
			"Someone who truly commands the lesson gets both right in under 2 minutes; someone who doesn't, misses at least one. No trick questions, no trivia. " +
			"Do NOT reuse or lightly rephrase the lesson's quick-check questions listed under 'avoid'. Each explanation teaches the key idea in 1–2 sentences. " +
			"For each question, list in `equations` the equation(s) it needs, omitting any that give the answer away. Double-check every answer before submitting.",
		prompt:
			`${context}\nUnit ${unit.id}: ${unit.title} — ${unit.summary}\n\n` +
			lessons.map(({ lesson, avoid }) => `${lessonBlock(lesson)}\n  avoid: ${avoid.join(" | ") || "(none)"}`).join("\n\n") +
			"\n\nWrite the diagnostic and call submit_diagnostic.",
		engine: deps.engine,
		signal: deps.signal,
		onStep: step(deps),
		neverSubmitted: "the diagnostic writer never submitted",
		validate: (v) => {
			const bad = v.questions.find((q) => !ids.has(q.lessonId));
			if (bad) return `unknown lessonId ${bad.lessonId}; use ids from the brief`;
			const short = [...ids].find((id) => v.questions.filter((q) => q.lessonId === id).length !== 2);
			if (short) return `lesson ${short} needs exactly 2 questions`;
			return v.questions.some((q) => q.kind === "mc" && (q.answer < 0 || q.answer >= q.options.length))
				? "an mc answer index is out of range of its options"
				: null;
		},
	});
	return out.questions;
}

const shortGradeSchema = Type.Object({
	grades: Type.Array(Type.Object({ credit: Type.Number({ minimum: 0, maximum: 1 }), feedback: Type.String() })),
});

export async function gradeShortAnswers(
	items: { prompt: string; rubric: string; modelAnswer: string; response: string }[],
	deps: WriterDeps,
): Promise<{ credit: number; feedback: string }[]> {
	if (items.length === 0) return [];
	const out = await runSubmitAgent<{ grades: { credit: number; feedback: string }[] }>({
		role: "checkWriter",
		toolName: "submit_grades",
		toolDescription: "Submit one grade per item, in order.",
		parameters: shortGradeSchema,
		fill: (x) => x,
		systemPrompt:
			`You grade short answers in a physics self-study program. ${LEARNER}\n` +
			"Credit 0..1 against the rubric (partial credit allowed). Feedback: one or two sentences, name what was right and the precise gap. " +
			"Judge the physics, not the phrasing.",
		prompt: items
			.map((it, i) => `Item ${i + 1}\nQuestion: ${it.prompt}\nRubric: ${it.rubric}\nModel answer: ${it.modelAnswer}\nLearner: ${it.response || "(blank)"}`)
			.join("\n\n"),
		engine: deps.engine,
		signal: deps.signal,
		onStep: step(deps),
		neverSubmitted: "the short-answer grader never submitted",
		validate: (v) => (v.grades.length !== items.length ? `expected ${items.length} grades, got ${v.grades.length}` : null),
	});
	return out.grades;
}

// ─── Problem sets, exams, placement ─────────────────────────────────────────

const problemsSchema = Type.Object({
	problems: Type.Array(
		Type.Object({
			unitId: Type.String(),
			lessonIds: Type.Array(Type.String(), { minItems: 1 }),
			prompt: Type.String({ description: "Self-contained statement; markdown + $math$. Include given data and what to find." }),
			equations: equationsField,
			points: Type.Integer({ minimum: 2, maximum: 20 }),
			rubric: Type.Array(Type.String(), { minItems: 1, description: 'Point-bearing criteria, e.g. "3 pts: correct boundary conditions at r = R"' }),
			solution: Type.String({ description: "Complete worked solution with every step." }),
			source: Type.Optional(Type.String({ description: 'Textbook provenance when adapted, e.g. "Griffiths EM 4e Problem 2.15 (adapted)"' })),
		}),
		{ minItems: 1, maxItems: 14 },
	),
});

export interface AssessmentSpec {
	kind: AssessmentKind;
	courseTitle: string;
	track: string;
	minutes: number | null;
	units: { id: string; title: string; summary: string; lessons: Lesson[] }[];
	problemCount: number;
}

export async function writeAssessment(spec: AssessmentSpec, deps: WriterDeps): Promise<Omit<AssessmentProblem, "id">[]> {
	const unitIds = new Set(spec.units.map((u) => u.id));
	const lessonIds = new Set(spec.units.flatMap((u) => u.lessons.map((l) => l.id)));
	const purpose: Record<AssessmentKind, string> = {
		pset: "a unit PROBLEM SET (homework): a ramp from a direct application to one or two genuinely challenging multi-step problems, like a good upper-division course's weekly set.",
		midterm: `a timed MIDTERM EXAM (${spec.minutes} min): problems a well-prepared student finishes in the time, covering the units evenly, mixing short conceptual items with 2–3 longer problems.`,
		final: `a timed FINAL EXAM (${spec.minutes} min): comprehensive, emphasising synthesis across units; qualifier-flavoured where the course is graduate-level.`,
		placement: `a PLACEMENT TEST (${spec.minutes} min): 1–2 diagnostic problems PER UNIT so the per-unit score shows whether the learner already commands that unit (and can skip it). Keep each problem short.`,
		worksheet: `a printable PRACTICE SHEET (about ${spec.minutes ?? 15} min, done on paper at work with only a calculator): short, self-contained problems spread across the listed lessons, each finishable in 2–4 minutes; no textbook look-ups needed; worked solutions brief but complete (they print on an answer page).`,
	};
	const out = await runSubmitAgent<{ problems: Omit<AssessmentProblem, "id">[] }>({
		role: "examWriter",
		toolName: "submit_assessment",
		toolDescription: "Submit the finished problems.",
		parameters: problemsSchema,
		fill: (x) => x,
		systemPrompt:
			`You are a physics professor writing ${purpose[spec.kind]} ${LEARNER}\n\n` +
			`${UNDERSTANDING_FIRST} ${calculationShare(spec.track)}\n\n` +
			"Rules:\n" +
			"- Mix: about a third conceptual problems (explain, predict, estimate, interpret a graph or a limit); the rest use equations and calculation to answer a physically meaningful question, and every calculational problem ends with a part asking what the result means.\n" +
			"- Every problem tags its unitId and the lessonIds it assesses (ids from the brief only).\n" +
			"- Prefer real textbook exercises: use book_search / book_lookup / book_read (when available) to find end-of-chapter problems for these sections, then adapt them (change numbers or ask a twist) and cite the source. Read only what you need.\n" +
			"- Problems must be solvable with the lesson content; state all given data; no ambiguity.\n" +
			"- Every problem lists in `equations` the equation(s) it needs (the learner sees them with the problem); leave out any equation the problem asks the learner to derive or state.\n" +
			"- Rubrics are point-bearing and sum to the problem's points; they reward correct setup and method, not just the final number.\n" +
			"- Solutions are complete and correct — verify each one (dimensions, limits, signs) before submitting.",
		prompt:
			`Course: ${spec.courseTitle}\nWrite about ${spec.problemCount} problems.\n\n` +
			spec.units.map((u) => `Unit ${u.id}: ${u.title} — ${u.summary}\n${u.lessons.map(lessonBlock).join("\n")}`).join("\n\n") +
			"\n\nWhen done, call submit_assessment.",
		engine: deps.engine,
		signal: deps.signal,
		onStep: step(deps),
		extraTools: deps.bookTools,
		maxTurns: deps.bookTools ? 16 : 4,
		neverSubmitted: "the exam writer never submitted",
		validate: (v) => {
			const bad = v.problems.find((p) => !unitIds.has(p.unitId) || p.lessonIds.some((l) => !lessonIds.has(l)));
			return bad ? `problem tagged with an unknown unit/lesson id (${bad.unitId} / ${bad.lessonIds.join(",")}); use ids from the brief` : null;
		},
	});
	return out.problems;
}

const gradeSchema = Type.Object({
	grades: Type.Array(
		Type.Object({
			problemId: Type.String(),
			points: Type.Number({ minimum: 0 }),
			feedback: Type.String({ description: "What was right, what was wrong, and how to fix it — specific to the learner's work." }),
			firstError: Type.Optional(Type.String({ description: "The first step where the reasoning went wrong, quoted or described." })),
		}),
	),
	summary: Type.String({ description: "2–4 sentences: overall strengths, the main gap, what to review." }),
});

export interface GradingInput {
	problems: AssessmentProblem[];
	answers: Record<string, { text: string; imageIndexes: number[] }>;
	images: { data: string; mimeType: string }[];
}

export async function gradeAssessment(input: GradingInput, deps: WriterDeps): Promise<{ grades: ProblemGrade[]; summary: string }> {
	const ids = new Set(input.problems.map((p) => p.id));
	const prompt = input.problems
		.map((p) => {
			const a = input.answers[p.id];
			const imgs = a?.imageIndexes.length ? ` Photos of handwritten work: image(s) #${a.imageIndexes.map((i) => i + 1).join(", #")} (in attachment order).` : "";
			return [
				`### Problem ${p.id} (${p.points} pts)`,
				p.prompt,
				`Rubric:\n${p.rubric.map((r) => `- ${r}`).join("\n")}`,
				`Reference solution:\n${p.solution}`,
				`Learner's typed answer: ${a?.text.trim() || "(none)"}.${imgs}`,
			].join("\n");
		})
		.join("\n\n");
	const out = await runSubmitAgent<{ grades: Omit<ProblemGrade, "max">[]; summary: string }>({
		role: "grader",
		toolName: "submit_grades",
		toolDescription: "Submit one grade per problem plus a summary.",
		parameters: gradeSchema,
		fill: (x) => x,
		systemPrompt:
			`You grade a physics student's work against rubrics. ${LEARNER}\n\n` +
			"Read the typed answer AND the attached photos of handwritten work for each problem (images are numbered in attachment order). " +
			"Weight understanding: credit correct physical reasoning and interpretation even when arithmetic slips, and call out conceptual misunderstandings explicitly (they matter more than algebra errors). " +
			"Award rubric points for correct reasoning even when the final answer is off; give no credit for an unsupported final answer where the rubric asks for method. " +
			"If handwriting is illegible, say which part and grade what you can read. Be fair, specific, and encouraging; never invent work that isn't there.",
		prompt,
		images: input.images,
		engine: deps.engine,
		signal: deps.signal,
		onStep: step(deps),
		neverSubmitted: "the grader never submitted",
		validate: (v) => {
			const missing = [...ids].filter((id) => !v.grades.some((g) => g.problemId === id));
			return missing.length ? `missing grades for problems: ${missing.join(", ")}` : null;
		},
	});
	const max = new Map(input.problems.map((p) => [p.id, p.points]));
	return {
		grades: out.grades
			.filter((g) => ids.has(g.problemId))
			.map((g) => ({ ...g, max: max.get(g.problemId)!, points: Math.min(g.points, max.get(g.problemId)!) })),
		summary: out.summary,
	};
}

// ─── Lesson notes ───────────────────────────────────────────────────────────

const notesSchema = Type.Object({
	notes: Type.String({ description: "The lesson notes: markdown with $…$ / $$…$$ math, ~1300–2200 words." }),
});

/** Written notes that teach the lesson on their own, beside the lecture. */
export async function writeLessonNotes(lesson: Lesson, context: string, track: string, deps: WriterDeps): Promise<string> {
	const out = await runSubmitAgent<{ notes: string }>({
		role: "notesWriter",
		toolName: "submit_notes",
		toolDescription: "Submit the finished lesson notes.",
		parameters: notesSchema,
		fill: (x) => x,
		systemPrompt:
			`You write the lesson notes for a physics/math self-study program: the text a learner reads to understand the lesson without the video. ${LEARNER}\n\n` +
			`${UNDERSTANDING_FIRST} ${calculationShare(track)}\n\n` +
			"Write markdown with KaTeX math ($…$ inline, $$…$$ display), about a 10–15 minute read (1300–2200 words), in this order:\n" +
			"## The big idea — 2–4 sentences: what this lesson is about and why it matters (to physics, and where natural to chemistry).\n" +
			"## Building intuition — the picture before the formalism: an everyday or chemical example, a thought experiment, what changes when what changes.\n" +
			"## The math — each key equation of the lesson in display math, then what every symbol means (with units), where it comes from (a short derivation or argument when it builds understanding), and its limits of validity.\n" +
			"## Worked example — 1–2 examples, physically meaningful, every step shown, ending with what the number means and a sanity check (units, limits, order of magnitude).\n" +
			"## Common mistakes — 3–5 bullets.\n" +
			"## Check yourself — 2–3 quick numbered questions, then a line **Answers:** followed by brief numbered answers (no HTML).\n" +
			"## Read more — the assigned book sections with printed page numbers.\n\n" +
			"Use the book tools (when available) to read the assigned pages and stay faithful to the textbook's notation and level; cite pages. " +
			"Plain, warm, precise prose; short paragraphs; no filler. Double-check every equation, number and unit.",
		prompt: `${context}\n\n${lessonBlock(lesson)}\n\nWrite the lesson notes and call submit_notes.`,
		engine: deps.engine,
		signal: deps.signal,
		onStep: step(deps),
		extraTools: deps.bookTools,
		maxTurns: deps.bookTools ? 12 : 4,
		neverSubmitted: "the notes writer never submitted",
		validate: (v) => (v.notes.split(/\s+/).length < 600 ? "the notes are too short; write the full lesson notes" : null),
	});
	return out.notes;
}

// ─── Audio-guide scripts ────────────────────────────────────────────────────

const scriptSchema = Type.Object({
	script: Type.String({ description: "Plain spoken English, no markdown, no symbols; ~1800–2400 words." }),
});

export async function writeAudioScript(lesson: Lesson, context: string, deps: WriterDeps): Promise<string> {
	const out = await runSubmitAgent<{ script: string }>({
		role: "scriptWriter",
		toolName: "submit_script",
		toolDescription: "Submit the finished spoken script.",
		parameters: scriptSchema,
		fill: (x) => x,
		systemPrompt:
			`You write audio guides — a warm, clear lecturer talking to one listener on a walk. ${LEARNER}\n\n` +
			"The listener cannot see anything, so: no markdown, no bullet points, no symbols, no LaTeX. Say math in words (\"E equals m c squared\", \"the integral from zero to infinity of e to the minus x squared\"). " +
			"Build intuition first, then the key results, one idea at a time; tie to chemistry where natural; recap at the end in three sentences. " +
			"About 12–15 minutes spoken (1800–2400 words). Use the book tools (when available) to stay faithful to the assigned reading.",
		prompt: `${context}\n\n${lessonBlock(lesson)}\n\nWrite the audio guide and call submit_script.`,
		engine: deps.engine,
		signal: deps.signal,
		onStep: step(deps),
		extraTools: deps.bookTools,
		maxTurns: deps.bookTools ? 10 : 4,
		neverSubmitted: "the script writer never submitted",
	});
	return out.script;
}
