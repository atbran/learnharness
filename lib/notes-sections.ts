/** Split lesson notes markdown into its "## " sections (heading → body),
 *  in order. Text before the first heading is dropped. */
export function notesSections(markdown: string): { heading: string; body: string }[] {
	const out: { heading: string; body: string }[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const h = /^##\s+(.+?)\s*$/.exec(line);
		if (h) out.push({ heading: h[1]!, body: "" });
		else if (out.length) out[out.length - 1]!.body += `${line}\n`;
	}
	return out.map((s) => ({ heading: s.heading, body: s.body.trim() }));
}

/** The fast-track summary: the notes' big idea, math and common mistakes,
 *  back as markdown (headings matched loosely: "The big idea — …" etc.). */
export function fastTrackNotes(markdown: string): string | null {
	const want = [/big idea/i, /the math/i, /common mistakes/i];
	const picked = notesSections(markdown).filter((s) => want.some((w) => w.test(s.heading)));
	return picked.length ? picked.map((s) => `## ${s.heading}\n\n${s.body}`).join("\n\n") : null;
}
