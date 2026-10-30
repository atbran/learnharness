/**
 * demo prebuild — the status counts every demo idea in the program, sees
 * built demos by their cache files, and the on/off switch persists. No
 * builds run here (the switch stays off), so no model is called.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { PATHS } from "../config.ts";
import { programIndex } from "../src/server/curriculum.ts";
import { demoPrebuildStatus, setDemoPrebuild } from "../src/server/demo-prebuild.ts";

test("status counts every idea, sees cached demos, and the switch persists", () => {
	const index = programIndex();
	const ideas = index.lessonOrder.reduce((n, id) => n + index.lessons.get(id)!.lesson.demoIdeas.length, 0);
	const first = index.lessonOrder.find((id) => index.lessons.get(id)!.lesson.demoIdeas.length > 0)!;

	const dir = path.join(PATHS.curriculum, "demos");
	const cached = path.join(dir, `${first}-0.json`);
	fs.mkdirSync(dir, { recursive: true });
	const before = demoPrebuildStatus();
	assert.equal(before.total, ideas);
	try {
		fs.writeFileSync(cached, JSON.stringify({ title: "t", html: "<p>x</p>", tested: true, createdAt: new Date().toISOString() }));
		const after = demoPrebuildStatus();
		assert.equal(after.built, before.built + 1);
		// An explainer's cache file is not a built demo.
		fs.writeFileSync(path.join(dir, `${first}-0-explainer.json`), "{}");
		assert.equal(demoPrebuildStatus().built, after.built);
	} finally {
		fs.rmSync(cached, { force: true });
		fs.rmSync(path.join(dir, `${first}-0-explainer.json`), { force: true });
	}

	const off = setDemoPrebuild(false);
	assert.equal(off.enabled, false);
	assert.equal(off.active, false);
	const saved = JSON.parse(fs.readFileSync(path.join(PATHS.curriculum, "demo-prebuild.json"), "utf8")) as { enabled: boolean };
	assert.equal(saved.enabled, false);
});

test("turning a builder on with nothing left to build returns (no spin)", async () => {
	const { createPrebuild } = await import("../src/server/prebuild.ts");
	const state = path.join(PATHS.curriculum, "zz-spin-prebuild.json");
	try {
		const b = createPrebuild({
			name: "zz-spin",
			stateFile: state,
			concurrency: 2,
			count: () => 1,
			built: () => new Set(programIndex().lessonOrder),
			cacheId: (lessonId) => lessonId,
			build: async () => {},
			error: () => null,
			label: (lesson) => lesson.title,
		});
		const s = b.set(true);
		assert.equal(s.built, s.total);
		assert.equal(s.building.length, 0);
	} finally {
		fs.rmSync(state, { force: true });
	}
});
