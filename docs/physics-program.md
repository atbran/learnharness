# Physics Program

A structured self-study path from an algebra refresh to first-year-graduate physics. It is built on top of LearnHarness's adaptive tutor.

- **Scope:** 19 courses, 528 lessons, about 1,085 hours, planned at ~8 h/week over ~130 weeks.
- **Depth:** the core is deep (math, mechanics, E&M, quantum, stat mech, each with a "grad touch" unit). Particle physics, astrophysics, GR and QFT are survey courses.

## Getting started

1. **Install and run.**
   ```bash
   npm install
   npm run dev      # http://localhost:3000 → opens the Program
   ```
2. **Models.** Open Settings and pick models for the three slots: strong, cheap and vision. With the Claude Code integration, opt in under Settings → Providers. Usage then goes through your Claude subscription. Recommended slots:

   | Slot | Model | Used for |
   |---|---|---|
   | strong | Opus or Sonnet | tutor sessions, problem sets, exams |
   | cheap | Haiku or Sonnet | quick checks, short-answer grading, audio scripts |
   | vision | Sonnet or Opus | grading photos of handwritten work, reading textbook figures |

3. **Books.** Open **Program → Bookshelf** and add a PDF for each textbook you own. You can also drop PDFs into `data/books/inbox/` and click *Scan inbox folder*. Free legal copies are linked where they exist (OpenStax, David Tong's notes, Carroll's GR notes). Indexing happens once, on your machine, with no AI tokens.
4. **Pace.** Click the ⚙ on the Program page to set your hours per week and start date. The timeline and projected finish date follow from these.

## How a lesson works

Each lesson page puts the lecture first:

1. **Watch the lecture.** Curated lectures (MIT OCW, Yale, Stanford, 3Blue1Brown, and others) play inline. Every link was checked; `npx tsx scripts/audit-lectures.ts` re-checks them.
2. **Read the assigned sections.** When the book is on the shelf, the lesson opens the reader at the exact pages.
3. **Learn with your tutor.** This starts a LearnHarness teaching session seeded with the lesson's objectives, key equations, page-resolved readings, and your weak spots. The tutor can look things up in your books via the book tools.
4. **Play with a demo** (a supplement). These are interactive simulations, built once and cached.
5. **Quick check.** Five questions. Multiple-choice and numeric answers are graded on the server without a model; short answers are graded by the cheap model. A score of 80% or higher masters the lesson and schedules spaced reviews (SM-2).

Further steps:

- **Practice** opens the Socratic practice engine for the lesson.
- **Problem sets** (one per unit), **midterms** and **finals** are generated once by the strong model. It cites and adapts real textbook exercises when the books are on the shelf. You can type your answers, photograph your handwritten work, or both. The vision model grades against a point rubric, shows where your reasoning first went wrong, and reveals the worked solution. *Discuss with tutor* opens a session about any problem.
- **Placement tests** (M0–M4, P1, P2) let you test out of units you already know.

## Progress

All progress is derived from an append-only ledger (`data/curriculum/progress.jsonl`). The Program page shows:

- **Stats:** program %, this week's hours against your goal, streak (one forgiven day per week), XP and level, projected finish, and reviews due.
- **Map:** zoomable course graph. Click a course to unfold its units and lessons, colored by status.
- **Timeline:** the original plan against the projection at your recent pace.
- **Mastery:** a subject radar, a study heatmap, and problem-set and exam score trends.
- **Badges.**

## Searching the books from a terminal

```bash
npx tsx scripts/books.ts search "method of images" --book griffiths-em
npx tsx scripts/books.ts lookup <lessonId>
npx tsx scripts/books.ts read griffiths-em 128 130
```

## Editing the curriculum

Course files live in `curriculum/physics/courses/*.json`, following the schema in `src/core/contracts/curriculum.ts` and the rules in `curriculum/AUTHORING.md`. Validate after any edit:

```bash
npm run validate:curriculum
```

Reading references (`§2.3 Electric Potential`) are matched against each PDF's outline at ingest time. The Bookshelf shows how many of each book's readings were located; click the count to list the ones that need fixing.

## Where things are

| Piece | Files |
|---|---|
| Schema, validation, progress math | `src/core/contracts/curriculum.ts`, `src/core/curriculum.ts`, `src/core/progress.ts`, `src/core/assessments.ts`, `src/core/bookshelf.ts` |
| Stores | `src/store/curriculum.ts` (ledger + caches), `src/store/bookshelf.ts` (node:sqlite FTS5 per book) |
| Server seams | `src/server/curriculum.ts`, `bookshelf.ts`, `assessments.ts`, `lectures.ts` |
| Agents | `src/agent/tools/books.ts` (book tools), `src/agent/subagents/program-writers.ts` (check/exam writers, grader, audio scripts) |
| UI | `app/program/**`, `components/program/**` |
