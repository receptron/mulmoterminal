// Builds the argv for spawning Antigravity (`agy`) as a first-class session.
// `agy` uses `--conversation <id>` to resume a conversation by ID.

export interface AntigravityArgsInput {
  // An Antigravity conversation ID to resume, or null to start a fresh conversation.
  resume: string | null;
  // Model override (--model), or null to use agy's configured default.
  model?: string | null;
  // Auto-approve tool permission requests (--dangerously-skip-permissions), the counterpart of
  // claude's `--permission-mode auto`.
  skipPermissions?: boolean;
  // A first turn to run on startup (--prompt-interactive), for a session spawned to DO something
  // — a collection action, a background chat. agy stays interactive afterwards, which is what
  // makes this the seed path rather than `--print`.
  initialPrompt?: string | null;
}

export function buildAntigravityArgs(input: AntigravityArgsInput): string[] {
  const args: string[] = [];

  if (input.model) {
    args.push("--model", input.model);
  }

  if (input.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

  if (input.resume) {
    args.push("--conversation", input.resume);
  }

  // Last: it takes a value, and a flag appended after it would read as part of the prompt.
  if (input.initialPrompt) {
    args.push("--prompt-interactive", input.initialPrompt);
  }

  return args;
}
