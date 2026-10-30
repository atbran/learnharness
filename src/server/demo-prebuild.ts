/**
 * Pre-build lesson demos in the background, two at a time, in program
 * order, so a demo opens instantly when the learner reaches it
 * (data/curriculum/demo-prebuild.json holds the switch, scope and failures).
 */

import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { builtDemos, demoBuildError, demoCacheId, demoTitle, ensureLessonDemo } from "./demos.ts";
import { createPrebuild, type PrebuildStatus } from "./prebuild.ts";

const demos = createPrebuild({
	name: "demos",
	stateFile: path.join(PATHS.curriculum, "demo-prebuild.json"),
	concurrency: 2,
	count: (lesson) => lesson.demoIdeas.length,
	built: builtDemos,
	cacheId: demoCacheId,
	build: (lessonId, i) => ensureLessonDemo(lessonId, i),
	error: demoBuildError,
	label: (lesson, i) => demoTitle(lesson.demoIdeas[i] ?? ""),
});

export type DemoPrebuildStatus = PrebuildStatus;
export const resumeDemoPrebuild = demos.resume;
export const setDemoPrebuild = demos.set;
export const demoPrebuildStatus = demos.status;
