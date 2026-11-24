// startIssueSession (#3413): a session hands an issue to an implementer of its own, in the issue's
// worktree, carrying the review tools (routes/issue-session-routes.ts); closeIssueSession closes one
// (routes/issue-session-close.ts). Host tools, in no tool group,
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

export const CLOSE_ISSUE_SESSION: ToolDefinition = {
  type: "function",
  name: "closeIssueSession",
  description:
    "Close an implementer session you started with startIssueSession: end the review loops it ran and close their reviewer cells, close its cell, then remove its local worktree and local branch (the remote branch stays). A worktree with uncommitted changes or commits no remote has is kept, and the answer says so. Refused for an implementer still at work — its PR neither merged nor closed — unless force is true. MulmoTerminal already closes an implementer on its own once its PR is merged or closed.",
  prompt:
    "Use `closeIssueSession` for an implementer whose session ended, or when the user asks to close one. Pass `force: true` only when the user says to close one that is still working.",
  parameters: {
    type: "object",
    properties: {
      session: { type: "string", description: "The chatId startIssueSession returned for the implementer." },
      force: { type: "boolean", description: "Close it even though its PR is still open. Only on the user's word." },
    },
    required: ["session"],
  },
};
