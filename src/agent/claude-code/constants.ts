export { CLAUDE_CODE_PROVIDER } from "../../core/contracts/claude-code.ts";

export const CLAUDE_CODE_API = "claude-code-cli";

// A held MCP call lasts until pi calls back with the tool result, which for a question tool is
// whenever the learner answers; this must outlast the live-process idle timeout so the CLI never
// times out first. The CLI reads it twice: MCP_TOOL_TIMEOUT caps a call's total time, and the
// bridge server's own "timeout" lifts the CLI's 300 s no-response-or-progress abort.
export const MCP_TOOL_TIMEOUT_MS = 30 * 60_000;

export enum ClaudeCodeError {
	CliNotFound = "claude CLI not found",
	NotSignedIn = "not signed in",
}
