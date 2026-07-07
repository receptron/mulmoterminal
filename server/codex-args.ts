// Builds the argv for spawning codex as a first-class session. codex mints its own session id
// (there is no `--session-id` like claude has), so a fresh session passes no id — the id is read
// back from the rollout file afterwards — while resume replays a known rollout id via the
// `resume` subcommand. Global flags precede the subcommand (codex's clap layout).
export interface CodexArgsInput {
  // A codex rollout id to resume, or null to start a fresh session.
  resume: string | null;
  // Model override (--model), or null to use codex's own configured default.
  model: string | null;
}

export function buildCodexArgs(input: CodexArgsInput): string[] {
  const args: string[] = [];
  if (input.model) args.push("--model", input.model);
  if (input.resume) args.push("resume", input.resume);
  return args;
}
