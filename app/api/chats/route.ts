import { chainsForSelection, formatChainLine } from "@/src/core";
import { newGraphContextMessage, newLessonContextMessage, type GraphContextPick } from "@/src/core";
import { compactionInFlight, createChat, lessonBrief, projectBrief, recordProgress, teachBackBrief, unitDrillBrief, isTurnRunning, listChats, readSettingsRecord, stores, titleFromPrompt } from "@/src/server";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight". */
export async function GET() {
	const chats: ChatListItem[] = listChats().map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
	}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; graphContext?: unknown; lessonId?: unknown; unitId?: unknown; courseId?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// Practice sessions (owner, 2026-10-04): kind "practice" marks the
	// record — the practice agent + its tools from turn 1, no extraction.
	const kind = body.kind === "practice" || body.kind === "project" ? ("practice" as const) : undefined;
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind);
	// PER-SESSION MODELS (owner, 2026-09-28): a session owns its model +
	// thinking level from birth — stamped verbatim from the STRONG slot,
	// the new-session default. From here the strong slot never reaches
	// this session again: in-session picks write the session's own record
	// (PUT /api/chats/:id/settings). No strong slot configured (fresh BYOK
	// boot) → no stamp; the turn gate's 503 models_not_configured envelope
	// refuses honestly until the setup flow fills the slot.
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	// The session's map context (owner, 2026-10-04): the picked
	// propositions ride the CREATION — message[0] is a graph-context
	// marker (a separate custom message BEFORE the learner's first user
	// message), carrying the picks plus the reasoning chains among them.
	// The picks carry their own name/statement (what the learner saw at
	// pick time); the chains derive from the CURRENT graph snapshot.
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, 64)
			: [];
	if (picks.length > 0) {
		const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
			formatChainLine(c, Object.fromEntries(byId)),
		);
		stores.chatStore.saveMessages(chat.id, [newGraphContextMessage(picks, chainLines)]);
	}
	// Physics program lessons: message[0] is the lesson brief (objectives,
	// readings with pages, learner history); the ledger links the session.
	if (typeof body.courseId === "string" && body.kind === "project") {
		// A course's optional capstone project: message[0] is the mentor brief.
		const brief = projectBrief(body.courseId);
		if (brief) stores.chatStore.saveMessages(chat.id, [newLessonContextMessage(brief.content, brief.details)]);
	} else if (typeof body.lessonId === "string" && body.kind === "teachback") {
		// Teach-back: the learner teaches the tutor (playing a confused student).
		const brief = teachBackBrief(body.lessonId);
		if (brief) stores.chatStore.saveMessages(chat.id, [newLessonContextMessage(brief.content, brief.details)]);
	} else if (typeof body.lessonId === "string") {
		const mode = kind === "practice" ? "practice" : "teach";
		const brief = lessonBrief(body.lessonId, mode);
		if (brief) {
			stores.chatStore.saveMessages(chat.id, [newLessonContextMessage(brief.content, brief.details)]);
			recordProgress({ type: "session_linked", at: new Date().toISOString(), lessonId: body.lessonId, chatId: chat.id, mode });
		}
	} else if (typeof body.unitId === "string" && kind === "practice") {
		// A unit's mixed drill: message[0] is the drill brief.
		const brief = unitDrillBrief(body.unitId);
		if (brief) stores.chatStore.saveMessages(chat.id, [newLessonContextMessage(brief.content, brief.details)]);
	}
	return Response.json({ id: chat.id, title: chat.title });
}
