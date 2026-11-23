// The tool a session driving a review reads a repository's `review` settings with (#3407). A host tool
// (routes/review-settings-route.ts), in no tool group, beside sendToSession / waitForSessionReply.
import type { ToolDefinition } from "gui-chat-protocol";

export const REVIEW_SETTINGS: ToolDefinition = {
  type: "function",
  name: "reviewSettings",
  description:
    "Read how a repository wants its changes reviewed: the reviewer agent, the most review rounds before a person is asked, and how many LGTMs on the current head (with every CI check passing) make a PR mergeable. Says so when the repository declares none.",
  prompt:
    "Call `reviewSettings` with the repository (owner/repo) before you run a review loop on one of its PRs. " +
    "When it declares none, do not review automatically: ask the user. " +
    "Start the reviewer with spawnBackgroundChat using the agent it names, talk to it with sendToSession / waitForSessionReply, and stop for the user once the round limit is reached.",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: "The repository, as owner/repo." },
    },
    required: ["repo"],
  },
};
