// Builds the argv for spawning Antigravity (`agy`) as a first-class session.
// `agy` uses `--conversation <id>` to resume a conversation by ID.

export interface AntigravityArgsInput {
  // An Antigravity conversation ID to resume, or null to start a fresh conversation.
  resume: string | null;
  // Model override (--model), or null to use agy's configured default.
  model?: string | null;
  // Reasoning effort (--effort), or null for default.
  effort?: "low" | "medium" | "high" | null;
  // Dangerously skip permissions (--dangerously-skip-permissions)
  skipPermissions?: boolean;
}

export function buildAntigravityArgs(input: AntigravityArgsInput): string[] {
  const args: string[] = [];

  if (input.model) {
    args.push("--model", input.model);
  }

  if (input.effort) {
    args.push("--effort", input.effort);
  }

  if (input.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  if (input.resume) {
    args.push("--conversation", input.resume);
  }

  return args;
}
