// Builds the argv for spawning Cursor CLI as a first-class session.
//
// ONE FLAG FOR BOTH NEW AND RESUME, as copilot has. `--resume <uuid>` starts a chat under an id we
// choose and later returns to it, so the id is OURS — no watcher, no attribution guess, no
// conversation map. Measured against cursor-agent 2026.09.10-fd3934a: a uuid this server invented,
// never passed through `create-chat`, starts a new chat and comes back as the `conversation_id` on
// every hook payload of that session. `create-chat` exists, prints an id, and is not needed —
// reaching for it would add a subprocess to every spawn to learn something we already decided.
//
// THE SEED IS A POSITIONAL ARGUMENT, NOT `-p`. `cursor-agent --resume <id> '<prompt>'` starts the
// TUI and runs the prompt inside it, and the TUI is still there afterwards (measured). `-p` is
// print mode: it runs the prompt and exits, which is the opposite of what a grid cell wants — and
// print mode ALSO fires a different set of hooks (cursor-hooks-file.ts), so a cell started that way
// would report no status even if it stayed alive.
//
// `--trust` IS NOT OPTIONAL HERE. A directory Cursor has not seen before shows a blocking
// "Workspace Trust Required" prompt, which in a grid cell is a modal nobody is watching. `--force`
// is the tool-approval counterpart, the same call copilot's `--allow-all-tools` makes.

export interface CursorArgsInput {
  /** The session key this server minted. Starts a new chat under it, or resumes that chat. */
  sessionId: string;
  /** Model override (--model), or null to use cursor's own configured default.
   *
   *  Cursor's model names are ACCOUNT-SPECIFIC and a wrong one is fatal: the CLI exits printing the
   *  whole list rather than falling back. So a configured model that the account does not have
   *  costs the cell, not just the choice — `cursor-agent --list-models` is what an operator checks. */
  model?: string | null;
  /** A first turn to run on startup, for a session spawned to DO something. Interactive
   *  afterwards — see the header on why this is positional rather than `-p`. */
  initialPrompt?: string | null;
}

export function buildCursorArgs(input: CursorArgsInput): string[] {
  const args: string[] = ["--resume", input.sessionId, "--force", "--trust"];

  if (input.model) args.push("--model", input.model);
  // Positional, and LAST: everything after it would be read as more prompt words.
  if (input.initialPrompt) args.push(input.initialPrompt);

  return args;
}
