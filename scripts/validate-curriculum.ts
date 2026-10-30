/**
 * Validate the curriculum spine: zod schemas + structural checks.
 *
 *   npx tsx scripts/validate-curriculum.ts            # whole program
 *   npx tsx scripts/validate-curriculum.ts p5-em      # one course (cross-course refs downgraded to warnings)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { booksCatalogSchema, courseSchema, programSchema, type Course, type Program } from "../src/core/contracts/curriculum.ts";
import { programHours, validateProgram, type CurriculumIssue } from "../src/core/curriculum.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "curriculum");
const only = process.argv[2];

function readJson(file: string): unknown {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

const catalog = booksCatalogSchema.parse(readJson(path.join(ROOT, "books.json")));
const meta = programSchema.parse(readJson(path.join(ROOT, "physics", "program.json")));
const ids = only ? [only] : meta.courses;

let failed = false;
const courseList: Course[] = [];
for (const id of ids) {
	const file = path.join(ROOT, "physics", "courses", `${id}.json`);
	if (!fs.existsSync(file)) {
		console.log(`MISSING  ${id}`);
		failed = true;
		continue;
	}
	const parsed = courseSchema.safeParse(readJson(file));
	if (!parsed.success) {
		failed = true;
		console.log(`SCHEMA   ${id}`);
		for (const issue of parsed.error.issues.slice(0, 30)) console.log(`  ${issue.path.join(".")}: ${issue.message}`);
		continue;
	}
	courseList.push(parsed.data);
}

const program: Program = { ...meta, courses: courseList.map((c) => c.id), courseList };
let issues: CurriculumIssue[] = validateProgram(program, catalog);
if (only) {
	issues = issues.map((i) =>
		/unknown prereq/.test(i.message) ? { ...i, level: "warning" as const } : i,
	);
}
for (const i of issues) console.log(`${i.level === "error" ? "ERROR  " : "warning"}  ${i.where}: ${i.message}`);
if (issues.some((i) => i.level === "error")) failed = true;

const lessons = courseList.reduce((n, c) => n + c.units.reduce((m, u) => m + u.lessons.length, 0), 0);
console.log(`\n${courseList.length} courses · ${lessons} lessons · ${programHours(program)} h planned`);
process.exit(failed ? 1 : 0);
