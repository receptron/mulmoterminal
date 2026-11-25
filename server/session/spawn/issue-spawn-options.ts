// How an issue's seed reaches its session: typed and left for review, or typed and run (#1253).
//
// A decision rather than two call sites because the two keys are NOT independent. planDraftInjection
// resolves `draft ?? initialPrompt`, so a spawn carrying both types the draft and never submits —
// no error, no warning, and the session simply sits there. Exactly one key is the invariant, and it
// is worth a test of its own; server/index.ts, where the spawn happens, has no way to have one.
import type { SpawnClaudeOptions } from "./agents/spawn-claude.js";

/** The seed's spawn options. `run` is the phone's (#1253): it has no Enter key, so text left in the
 *  input box is where the work stops. The desktop keeps the draft — there, the person who opened
 *  the issue and the person about to run it are often not the same. */
export interface IssueSpawnExtras {
  permissionMode?: string | undefined;
  allTools?: boolean;
  allowedTools?: readonly string[];
}

export function issueSpawnOptions(cwd: string, seed: string, run: boolean, extras: IssueSpawnExtras = {}): SpawnClaudeOptions {
  const { permissionMode, allTools = false, allowedTools = [] } = extras;
  return {
    cwd,
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(allowedTools.length > 0 ? { extraAllowedTools: allowedTools } : {}),
    // A working session in a repository, the same shape as a grid dev terminal: it takes its GUI
    // tools from the project's own MCP config rather than from an all-tools url of ours — unless a
    // session started it to run the issue through the review tools (#3413), which only that url has.
    attachGuiMcp: allTools,
    ...(run ? { initialPrompt: seed } : { draft: seed }),
  };
}
