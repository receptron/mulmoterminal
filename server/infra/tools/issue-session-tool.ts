// startIssueSession (#3413): a session hands an issue to an implementer of its own, in the issue's
// worktree, carrying the review tools (routes/issue-session-routes.ts). Host tool, in no tool group,
// beside spawnBackgroundChat. MulmoClaude has no counterpart.
import type { ToolDefinition } from "gui-chat-protocol";
import { FULL_GUI_MCP_AGENTS } from "../../../common/guiMcpAgents.js";

export const START_ISSUE_SESSION: ToolDefinition = {
  type: "function",
  name: "startIssueSession",
  description:
    "Start an implementer session on a GitHub issue: MulmoTerminal cuts the issue's worktree in the repository's default clone and starts the agent there, running the mulmoterminal-issue-to-merge skill on the issue. The session gets a cell, asks the user its own questions there, and can be talked to with sendToSession. Returns at once with its chatId. Refused past the maxIssueSessions limit of running implementers. When its PR is merged or closed, when its session ends, and when it stops on the user, a line starting with [startIssueSession] is typed into your session (while your session is still running).",
  prompt:
    "Use `startIssueSession` only for issues the user named. Start one per issue, up to the limit the refusal states, and start the next when a [startIssueSession] line says one finished. Do not poll the implementers. " +
    "When a line says one is waiting for the user, tell the user which cell to answer in; do not answer an implementer's questions for the user, and do not merge for it: it runs its own review loop and merge.",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: "The GitHub repository, as owner/repo. GitLab is refused: the skill reads issues and PRs with gh." },
      issue: { type: "number", description: "The issue number." },
      agent: { type: "string", enum: [...FULL_GUI_MCP_AGENTS], description: "Which agent implements it (default claude)." },
    },
    required: ["repo", "issue"],
  },
};
