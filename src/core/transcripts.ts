/**
 * Lecture transcripts (pure): the fetched `.txt` files hold one "[m:ss] text"
 * (or "[h:mm:ss] text") line per ~30 s chunk. Parsed into timed lines and
 * trimmed to a lecture clip's window for the clickable transcript.
 */

export interface TranscriptLine {
	/** Seconds from the start of the video. */
	t: number;
	text: string;
}

const LINE = /^\[(?:(\d+):)?(\d+):(\d{2})\]\s*(.*)$/;

export function parseTranscript(raw: string): TranscriptLine[] {
	const out: TranscriptLine[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const m = LINE.exec(line.trim());
		if (!m) continue;
		const t = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
		const text = (m[4] ?? "").trim();
		if (text) out.push({ t, text });
	}
	return out;
}

/** The lines inside a clip [start, end): the line already running at
 *  `start` is kept, so the clip opens mid-sentence rather than skipping it. */
export function clipTranscript(lines: readonly TranscriptLine[], start?: number, end?: number): TranscriptLine[] {
	const from = start ?? 0;
	const firstIn = lines.findIndex((l) => l.t >= from);
	const begin = firstIn === -1 ? lines.length : firstIn > 0 && lines[firstIn]!.t > from ? firstIn - 1 : firstIn;
	return lines.slice(Math.max(0, begin)).filter((l) => end === undefined || l.t < end);
}
