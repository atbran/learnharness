/**
 * Validate the authored quick checks (curriculum/physics/checks/*.json):
 * schema, lesson ids, answer indexes, and the understanding-first mix
 * (physics: at most 2 of 5 calculational; math courses may be heavier).
 *
 *   npx tsx scripts/validate-checks.ts [courseId]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { courseChecksSchema, courseSchema } from "../src/core/contracts/curriculum.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "curriculum", "physics");
const only = process.argv[2];
let failed = false;
let total = 0;
let lessonsCovered = 0;
let lessonsAll = 0;

for (const f of fs.readdirSync(path.join(ROOT, "courses")).filter((n) => n.endsWith(".json"))) {
	const course = courseSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, "courses", f), "utf8")));
	if (only && course.id !== only) continue;
	const lessons = course.units.flatMap((u) => u.lessons.map((l) => l.id));
	lessonsAll += lessons.length;
	const file = path.join(ROOT, "checks", `${course.id}.json`);
	if (!fs.existsSync(file)) {
		console.log(`MISSING  ${course.id} (0/${lessons.length} lessons)`);
		continue;
	}
	const parsed = courseChecksSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
	if (!parsed.success) {
		failed = true;
		console.log(`SCHEMA   ${course.id}`);
		for (const i of parsed.error.issues.slice(0, 20)) console.log(`  ${i.path.join(".")}: ${i.message}`);
		continue;
	}
	const { checks } = parsed.data;
	if (parsed.data.courseId !== course.id) {
		failed = true;
		console.log(`ERROR    ${course.id}: courseId field is "${parsed.data.courseId}"`);
	}
	for (const [lessonId, qs] of Object.entries(checks)) {
		if (!lessons.includes(lessonId)) {
			failed = true;
			console.log(`ERROR    ${course.id}: unknown lesson ${lessonId}`);
		}
		qs.forEach((q, i) => {
			if (q.kind === "mc" && q.answer >= q.options.length) {
				failed = true;
				console.log(`ERROR    ${lessonId} q${i + 1}: answer index ${q.answer} out of range`);
			}
		});
		const calc = qs.filter((q) => q.kind === "numeric").length;
		if (course.track !== "math" && calc > Math.floor(qs.length / 2)) console.log(`warning  ${lessonId}: ${calc} numeric questions (physics checks are understanding-first: ≤ 2)`);
		total += qs.length;
	}
	// Answer-length bias: a test-wise learner picks the longest option. Flag
	// questions whose key is much longer than its distractors, and courses
	// where the key is the longest option far more often than chance.
	let mcCount = 0;
	let keyLongest = 0;
	for (const [lessonId, qs] of Object.entries(checks))
		qs.forEach((q, i) => {
			if (q.kind !== "mc") return;
			mcCount++;
			const lens = q.options.map((o) => o.length);
			const key = lens[q.answer] ?? 0;
			const others = lens.filter((_, k) => k !== q.answer);
			if (key === Math.max(...lens) && lens.filter((l) => l === key).length === 1) keyLongest++;
			const mean = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
			if (key > 1.4 * mean && key - mean > 25) console.log(`bias     ${lessonId} q${i + 1}: key ${key} chars vs distractors ~${Math.round(mean)}`);
		});
	if (mcCount && keyLongest / mcCount > 0.35)
		console.log(`warning  ${course.id}: the key is the longest option in ${Math.round((keyLongest / mcCount) * 100)}% of mc questions (chance ≈ ${Math.round(100 / 4)}%; keep ≤ 35%)`);
	const covered = lessons.filter((l) => checks[l]).length;
	lessonsCovered += covered;
	const missing = lessons.filter((l) => !checks[l]);
	console.log(`${missing.length ? "partial " : "ok      "} ${course.id}: ${covered}/${lessons.length} lessons${missing.length ? ` (missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""})` : ""}`);
}
console.log(`\n${lessonsCovered}/${lessonsAll} lessons have authored checks · ${total} questions`);
process.exit(failed ? 1 : 0);
