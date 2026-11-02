import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { serverExecute } from "../tool-execute.ts";
import { danglingQuestionOf, unprovenPlanSteps } from "../../core/native-messages.ts";
import type { ChatStore } from "../../core/ports.ts";

/** What the lesson_mastered tool closes over: the program lesson this
 *  teach session is for, and the ledger seams (injected, so this module
 *  never imports the server). */
export interface LessonMasteredContext {
	chatId: string;
	chatStore: ChatStore;
	lessonId: string;
	/** Is the lesson already mastered (quick check, test-out, earlier session)? */
	isMastered: () => boolean;
	/** Append the tutor_mastered event to the progress ledger. */
	recordMastered: () => void;
}

const lessonMasteredInput = Type.Object({
	summary: Type.String({
		minLength: 1,
		description: "One or two sentences to the learner: what they can now do, objective by objective, that shows the lesson is mastered.",
	}),
});

/**
 * lesson_mastered — the tutor's call that a program lesson is done (owner
 * 2026-11-01, "Tutor + proof"). SERVER-SIDE. The tutor's judgment counts
 * only with proof: every step on the session's plan map must have a passed
 * latest check (unprovenPlanSteps). A refusal names the unproven steps and
 * goes back to the tutor, which keeps teaching; success appends
 * tutor_mastered to the ledger, which counts like a passing quick check.
 */
export function lessonMasteredTool(ctx: LessonMasteredContext): Record<string, AgentTool<any>> {
	return {
		lesson_mastered: {
			name: "lesson_mastered",
			label: "lesson_mastered",
			description:
				"Mark this program lesson as mastered — it counts like a passing quick check (mastered, spaced review scheduled, " +
				"next lessons unlock). Call it once, when you judge every objective met AND every step on your plan map has a " +
				"check he passed (the latest check tagged to each step, answered correctly). Refused while a question is open, " +
				"before a plan map exists, or while any step is unproven — the refusal names those steps: check them, then call again. " +
				"After it succeeds, say a short closing sentence and end your turn.",
			parameters: lessonMasteredInput,
			execute: serverExecute("lesson_mastered", lessonMasteredInput, async () => {
				const record = ctx.chatStore.getChat(ctx.chatId);
				if (!record) return { ok: false, error: `Chat not found: ${ctx.chatId}` };
				if (danglingQuestionOf(record.messages) !== null)
					return { ok: false, error: "A question is still open — let him answer it before calling lesson_mastered." };
				if (ctx.isMastered()) return { text: JSON.stringify({ ok: true, alreadyMastered: true }), details: { ok: true, alreadyMastered: true } };
				const tree = record.tree;
				if (!tree || tree.nodes.length === 0)
					return { ok: false, error: "No plan map yet — write it with plan_init and check each step before calling lesson_mastered." };
				const unproven = unprovenPlanSteps(tree, record.messages);
				if (unproven.length > 0)
					return {
						ok: false,
						error:
							`Not yet: these plan steps have no passed check (the latest check tagged to each must be answered correctly) — ` +
							`${unproven.map((n) => `${n.title} [${n.id}]`).join("; ")}. Check them, then call lesson_mastered again.`,
					};
				ctx.recordMastered();
				return { text: JSON.stringify({ ok: true }), details: { ok: true } };
			}),
		},
	};
}
