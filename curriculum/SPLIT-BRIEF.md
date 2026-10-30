# Brief: split lessons into 30–45 minute lessons

The learner wants **more, shorter lessons**: each lesson, including its quick check, should take **30–45 minutes**.
A longer lecture video is fine; its overflow doesn't count. Today's lessons run 60–120 min. Split every lesson into
**2–3 lessons, each one coherent idea with 2–3 objectives**, and rebuild the quick checks to match.

Read first:
- `curriculum/AUTHORING.md` (course rules, now with the 30–45 min rule)
- `curriculum/CHECKS-AUTHORING.md` (check rules: the learner's understanding-first philosophy, 3–4 questions per lesson,
  no answer-length tell)
- `curriculum/ERRATA.md` (content fixes; apply any entry for your courses, but don't edit that file: the main session clears it)
- `src/core/contracts/curriculum.ts` (schemas)

## Course file (`curriculum/physics/courses/<id>.json`)

- **Course-level fields:** keep the course's id, metadata, units (same unit ids, titles, summaries) and exams unchanged.
- **Lessons:** split each into 2–3 consecutive lessons:
  - `minutes`: 30–45 each. The course total must stay at **60–75% of course hours** (the validator checks this).
  - `id`: renumber sequentially across the course in the existing style, e.g. `p5-l001-…`, `p5-l002-…`, keeping a
    descriptive kebab slug. Ids must stay globally unique.
  - `title`: specific to the new, narrower idea.
  - `objectives`: 2–3, taken from the parent's (refine wording, don't lose any parent objective across the children).
  - `keyEquations`, `demoIdeas`, `practice`: give each child the ones that belong to it.
  - `readings`: narrow to the relevant subsection when you're confident it exists, otherwise keep the parent's ref.
  - `lectures`: give each child the lecture(s) for its idea. When one long lecture covers several children, attach it to
    each and say which part in the title, e.g. "Lecture 7 (first half: …)". Never invent URLs or timestamps; only reuse
    lecture objects that are already in the file.
  - `prereqs`: remap old ids to the new id of the relevant child (usually the last child of the old lesson).
- Keep the JSON tab-indented.

## Check file (`curriculum/physics/checks/<id>.json`)

- Rebuild it for the new lesson ids: **3–4 questions per lesson, exactly 1 `short`** each.
- **Reuse** the parent's existing questions on the child they fit (they are already reviewed and length-balanced; keep
  their text and answer keys). **Write new questions** to fill each child up to 3–4, including a new `short` where a
  child doesn't inherit one.
- New numerics: compute them in Python. New mc: 4 options, plausible misconception distractors, and no length tell.

## Done means

- `npx tsx scripts/validate-curriculum.ts <id>`: no ERROR/SCHEMA lines and no hour-share warning.
- `npx tsx scripts/validate-checks.ts <id>`: `ok`, with no bias lines and no warnings.
- Every lesson is 30–45 min. Every parent objective survives in some child.
- Only your course and check files were touched. Nothing committed.

Report: lessons before → after per course, any lecture you couldn't place, and any content fixes you made.
