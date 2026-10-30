/**
 * ink-pad — the pure page model behind the Pencil answer pad: stroke
 * serialisation, IndexedDB read-back validation, the stroke eraser, the
 * outline path, and upload reconciliation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { blankPage, eraseAt, normalizePage, outlineToPath, pushPoint, reconcileUploads, strokeHit, strokeOutline, strokePoints, type Stroke } from "../components/program/ink-pad.tsx";

function stroke(points: [number, number, number][], extra: Partial<Stroke> = {}): Stroke {
	const pts: number[] = [];
	for (const [x, y, p] of points) pushPoint(pts, x, y, p);
	return { id: "s", tool: "pen", color: "#111111", size: 3.2, pressure: true, pts, ...extra };
}

test("points are stored flat and rounded (x, y to 0.1, pressure to 0.01, clamped)", () => {
	const s = stroke([
		[10.04, 20.06, 0.333],
		[11.5, 21.25, 1.7],
	]);
	assert.deepEqual(s.pts, [10, 20.1, 0.33, 11.5, 21.3, 1]);
	assert.deepEqual(strokePoints(s), [
		[10, 20.1, 0.33],
		[11.5, 21.3, 1],
	]);
});

test("a page survives the IndexedDB round trip; junk strokes are dropped", () => {
	const page = { ...blankPage("pset-a", "p1", 2, "grid"), strokes: [stroke([[1, 2, 0.5], [3, 4, 0.5]])], upload: "pset-a-p1-abc123.png" };
	const back = normalizePage(structuredClone(page), "pset-a", "p1");
	assert.deepEqual(back, page);

	const junk = { ...page, paper: "papyrus", strokes: [{ tool: "laser", pts: [1, 2, 3] }, { tool: "pen", color: "#000", size: 3, pts: [1, 2] }, null, page.strokes[0]] };
	const cleaned = normalizePage(junk, "pset-a", "p1");
	assert.equal(cleaned?.paper, "blank");
	assert.equal(cleaned?.strokes.length, 1);
	assert.equal(normalizePage(page, "pset-a", "p2"), null, "another problem's page is not this one");
	assert.equal(normalizePage("nope", "pset-a", "p1"), null);
});

test("the stroke eraser removes only strokes it touches", () => {
	const a = stroke([[0, 0, 0.5], [100, 0, 0.5]], { id: "a" });
	const b = stroke([[0, 200, 0.5], [100, 200, 0.5]], { id: "b" });
	assert.ok(strokeHit(a, 50, 7.5, 6), "reach is r + half the stroke width (6 + 1.6)");
	assert.ok(!strokeHit(a, 50, 7.7, 6));
	assert.ok(!strokeHit(a, 50, 30, 6));
	const all = [a, b];
	assert.equal(eraseAt(all, 500, 500), all, "nothing hit: same array (no history step)");
	assert.deepEqual(
		eraseAt(all, 50, 195).map((s) => s.id),
		["a"],
	);
	const dot = stroke([[300, 300, 0.5]]);
	assert.ok(strokeHit(dot, 305, 300, 4));
});

test("outlines become closed SVG paths", () => {
	const s = stroke([
		[10, 10, 0.4],
		[40, 30, 0.6],
		[80, 20, 0.8],
	]);
	const d = outlineToPath(strokeOutline(s));
	assert.match(d, /^M[\d.-]+,[\d.-]+ Q/);
	assert.ok(d.endsWith("Z"));
	assert.equal(outlineToPath([[0, 0]]), "");
	const hl = strokeOutline({ ...s, tool: "highlighter", size: 22 });
	assert.ok(hl.length > 3);
});

test("a saved page whose thumbnail was removed becomes a draft again", () => {
	const saved = { ...blankPage("x", "p1", 0, "blank"), strokes: [stroke([[1, 1, 0.5]])], upload: "x-p1-aaaaaa.png", dirty: false };
	const kept = { ...saved, page: 1, upload: "x-p1-bbbbbb.png" };
	const [a, b] = reconcileUploads([saved, kept], ["x-p1-bbbbbb.png"]);
	assert.equal(a?.upload, null);
	assert.equal(a?.dirty, true);
	assert.equal(b, kept);
});
