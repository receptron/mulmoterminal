// The machine-global hook files, as one lifecycle.
//
// Two agents keep one: copilot (`$COPILOT_HOME/hooks/mulmoterminal.json`) and cursor
// (`~/.cursor/hooks.json`). Neither CLI has a per-spawn flag for hooks — claude's `--settings` has
// no counterpart in either — so the file outlives the process that wrote it, and it names this
// server's port. That is the whole reason this pair is a lifecycle rather than two unrelated calls:
//
//   - ON EXIT the file must GO, or the agent keeps posting every prompt and tool argument to
//     whatever takes that port next. Each agent's remover is licensed by what THIS process
//     published, so a peer's live file is never the one removed.
//   - AT STARTUP a file left by a server that died badly must be REPAIRED, not removed — proving
//     ownership of a file written by a process that no longer exists cannot be done from disk
//     alone, so the stale one is rewritten with this server's port. A live peer's is left to it.
//
// Kept together so a third agent with the same shape is added in one place, and so index.ts carries
// the call rather than the argument.
import { removeCopilotHooksFile, repairStaleCopilotHooksFile } from "./copilot-hooks-file.js";
import { removeCursorHooksFile, repairStaleCursorHooksFile } from "./cursor-hooks-file.js";

const LOCALHOST = "127.0.0.1";

/** Repair whatever a badly-died server left behind, and arrange for ours to go on the way out. */
export function wireMachineGlobalHooks(port: string | number): void {
  process.on("exit", () => removeCopilotHooksFile());
  process.on("exit", () => removeCursorHooksFile());
  repairStaleCopilotHooksFile(LOCALHOST, port);
  repairStaleCursorHooksFile(port);
}
