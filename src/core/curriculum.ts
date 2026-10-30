/**
 * Pure curriculum logic over the static spine: indexes, validation,
 * prerequisite resolution. No IO — the fs loader is src/store/curriculum.ts.
 */

import type { BooksCatalog, Course, Exam, Lesson, Program, Unit } from "./contracts/curriculum.ts";

export interface LessonRef {
	lesson: Lesson;
	unit: Unit;
	course: Course;
	/** Position in the program's global lesson order. */
	order: number;
}

export interface ProgramIndex {
	program: Program;
	lessons: Map<string, LessonRef>;
	/** Lesson ids in program order (course order, then unit, then lesson). */
	lessonOrder: string[];
	courses: Map<string, Course>;
	units: Map<string, { unit: Unit; course: Course }>;
	exams: Map<string, { exam: Exam; course: Course }>;
}

export function indexProgram(program: Program): ProgramIndex {
	const lessons = new Map<string, LessonRef>();
	const lessonOrder: string[] = [];
	const courses = new Map<string, Course>();
	const units = new Map<string, { unit: Unit; course: Course }>();
	const exams = new Map<string, { exam: Exam; course: Course }>();
	for (const course of program.courseList) {
		courses.set(course.id, course);
		for (const exam of course.exams) exams.set(exam.id, { exam, course });
		for (const unit of course.units) {
			units.set(unit.id, { unit, course });
			for (const lesson of unit.lessons) {
				lessons.set(lesson.id, { lesson, unit, course, order: lessonOrder.length });
				lessonOrder.push(lesson.id);
			}
		}
	}
	return { program, lessons, lessonOrder, courses, units, exams };
}

/** Every lesson that must be mastered before `lessonId`: its explicit
 *  prereqs plus the previous lesson in its unit (or the last lesson of the
 *  previous unit in the same course). Cross-course ordering comes from the
 *  course prereqs: a course's first lesson requires the final lessons of
 *  its prerequisite courses. */
export function lessonPrereqs(index: ProgramIndex, lessonId: string): string[] {
	const ref = index.lessons.get(lessonId);
	if (!ref) return [];
	const out = new Set(ref.lesson.prereqs);
	const courseLessons = ref.course.units.flatMap((u) => u.lessons.map((l) => l.id));
	const pos = courseLessons.indexOf(lessonId);
	if (pos > 0) out.add(courseLessons[pos - 1]!);
	else {
		for (const pre of ref.course.prereqs) {
			const c = index.courses.get(pre);
			const last = c?.units.at(-1)?.lessons.at(-1);
			if (last) out.add(last.id);
		}
	}
	return [...out].filter((id) => index.lessons.has(id));
}

export interface CurriculumIssue {
	level: "error" | "warning";
	where: string;
	message: string;
}

/** Structural validation beyond the zod schemas: unique ids, resolvable
 *  references, acyclic prerequisites, hour budgets. */
export function validateProgram(program: Program, catalog: BooksCatalog): CurriculumIssue[] {
	const issues: CurriculumIssue[] = [];
	const err = (where: string, message: string) => issues.push({ level: "error", where, message });
	const warn = (where: string, message: string) => issues.push({ level: "warning", where, message });
	const seen = new Map<string, string>();
	const claim = (id: string, where: string) => {
		const prev = seen.get(id);
		if (prev) err(where, `duplicate id "${id}" (also ${prev})`);
		else seen.set(id, where);
	};
	const bookIds = new Set(catalog.books.map((b) => b.id));
	const courseIds = new Set(program.courseList.map((c) => c.id));

	for (const id of program.courses) if (!courseIds.has(id)) err("program", `course "${id}" has no courses/${id}.json`);

	for (const course of program.courseList) {
		claim(course.id, `course ${course.id}`);
		for (const p of course.prereqs) if (!courseIds.has(p)) err(`course ${course.id}`, `unknown prereq course "${p}"`);
		for (const b of course.books) if (!bookIds.has(b.bookId)) err(`course ${course.id}`, `unknown book "${b.bookId}"`);
		let minutes = 0;
		for (const unit of course.units) {
			claim(unit.id, `unit ${unit.id}`);
			for (const lesson of unit.lessons) {
				claim(lesson.id, `lesson ${lesson.id}`);
				minutes += lesson.minutes;
				for (const r of lesson.readings) if (!bookIds.has(r.bookId)) err(`lesson ${lesson.id}`, `unknown book "${r.bookId}"`);
			}
		}
		const unitIds = new Set(course.units.map((u) => u.id));
		for (const exam of course.exams) {
			claim(exam.id, `exam ${exam.id}`);
			for (const u of exam.covers) if (!unitIds.has(u)) err(`exam ${exam.id}`, `covers unknown unit "${u}"`);
		}
		const share = minutes / 60 / course.hours;
		if (share < 0.5 || share > 0.9)
			warn(`course ${course.id}`, `lessons total ${(minutes / 60).toFixed(1)} h = ${(share * 100).toFixed(0)}% of ${course.hours} h (expected 50-90%; the rest is problem sets and exams)`);
	}

	const index = indexProgram(program);
	for (const [id, ref] of index.lessons) {
		for (const p of ref.lesson.prereqs) if (!index.lessons.has(p)) err(`lesson ${id}`, `unknown prereq lesson "${p}"`);
	}

	// Cycle check over the full lesson prerequisite relation.
	const state = new Map<string, 1 | 2>();
	const visit = (id: string, path: string[]): void => {
		const s = state.get(id);
		if (s === 2) return;
		if (s === 1) {
			err(`lesson ${id}`, `prerequisite cycle: ${[...path, id].join(" -> ")}`);
			return;
		}
		state.set(id, 1);
		for (const p of lessonPrereqs(index, id)) visit(p, [...path, id]);
		state.set(id, 2);
	};
	for (const id of index.lessonOrder) visit(id, []);
	return issues;
}

/** Total planned hours for the program (course budgets). */
export function programHours(program: Program): number {
	return program.courseList.reduce((s, c) => s + c.hours, 0);
}
