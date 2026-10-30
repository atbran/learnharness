# Authoring brief: quick checks

Every lesson in `curriculum/physics/courses/*.json` gets a 5-question **quick check**, stored in
`curriculum/physics/checks/<courseId>.json`. A learner who scores 80% or higher has mastered the
lesson. The same questions are reused for spaced review months later, so each one should still
test the lesson's core idea when it comes back.

## The learner and the philosophy (read carefully)

The learner is an organic chemist working toward first-year-PhD physics. In their words, they get
much more value from **understanding the nature behind entropy and ΔH in free energy** than from
"banging out 20 practice problems behind Gibbs free energy". They still need to use equations and
calculate, but practice and calculation should be **20–50% of the work, not the majority**.
**Math courses are the exception**: there, technique is the understanding.

So, per lesson (5 questions):

- **Physics, survey and capstone courses** (`p*`, `s*`, `q-*`):
  - At least 3 questions test **understanding**: what an equation means physically, why a result holds,
    what happens in a limit or a changed situation, predicting real-world behaviour, spotting a
    misconception, or connecting to chemistry and everyday phenomena.
  - At most 2 are calculational: `numeric` questions or calculation-flavoured `mc`. Make them quick and
    physically meaningful, ideally an estimate with real numbers, never an algebra marathon.
- **Math courses** (`m*`): about 3 technique and computation questions and 2 conceptual ones ("what does
  this tell you", "when does this method fail", "geometric meaning"). Tie the math to physics or
  chemistry uses where natural.

Every check covers **all of the lesson's objectives** (one question can cover two).

## Question kinds (schema: `checkQuestionSchema` in `src/core/contracts/curriculum.ts`)

```json
{ "kind": "mc", "prompt": "…", "options": ["…", "…", "…", "…"], "answer": 2, "explanation": "…" }
{ "kind": "numeric", "prompt": "… (give the answer in kJ/mol)", "answer": -237.1, "tolerance": 0.02, "unit": "kJ/mol", "explanation": "…" }
{ "kind": "short", "prompt": "Explain why …", "rubric": "Full credit requires: …", "modelAnswer": "…" }
```

- **Mix:** each check has 2–3 `mc`, 0–2 `numeric`, and exactly 1 `short` (the short one is always an
  "explain in your own words" item).
- **`mc`:**
  - Use 4 options. Distractors come from **real misconceptions**, never jokes or obvious throwaways.
  - `answer` is a 0-based index. Vary the position of the right answer across questions.
- **`numeric`:**
  - The prompt states exactly what to give and in which units.
  - `tolerance` is relative (0.02 normally, 0.05–0.1 for estimates).
  - **Compute every numeric answer with Python before writing it.**
- **`explanation` / `modelAnswer`:** teach the idea in 1–3 sentences. This is what the learner reads
  after answering.
- **Math:** use `$…$` inline and `$$…$$` display, in JSON strings with escaped backslashes (`"$\\Delta G = \\Delta H - T\\Delta S$"`).
- **Self-contained:** questions stand alone (no "as in the lecture"). Don't test trivia, notation recall, or a
  textbook's section numbering.

## File format

```json
{
	"courseId": "p7-statmech",
	"checks": {
		"p7-l001-…": [ { … }, { … }, { … }, { … }, { … } ],
		"p7-l002-…": [ … ]
	}
}
```

One entry per lesson id in that course, in course order. Write tab-indented JSON. Generating it from a
small script in your scratchpad is fine (and makes the numeric checks easy).

## Quality bar and validation

- **Correctness is non-negotiable.** Before finishing, re-check every answer key: the mc index points at the right
  option, numerics come from a computation, and model answers are correct.
- Run `npx tsx scripts/validate-checks.ts <courseId>`. It must show `ok` for your courses, with no ERROR
  or SCHEMA lines and no "numeric questions" warnings for physics lessons.
