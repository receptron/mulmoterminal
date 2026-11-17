// The drops root marked trusted for Claude Code (#3313), so a cell handed its drop directory with
// --add-dir is not stopped at startup to approve it. The ROOT, not the session's directory: Claude
// Code accepts trust from an ancestor of a folder outside a git repository, so one entry covers every
// session, where one per session would grow the user's config with a key for each cell ever opened.
// Why trusting it is safe, and how the write is made, is own-folder-trust.ts.
import { folderTrustMarker } from "../agents/claude/own-folder-trust.js";
import { claudeProjectPath, claudeUserConfigFile } from "./project-dir.js";
import { accountSpawnEnv } from "./session-home.js";
import { DROPS_ROOT } from "./session-drops.js";

const markDropsRoot = folderTrustMarker();

/** Trust the drops root in the config of the login this session's claude runs on: its account's
 *  CLAUDE_CONFIG_DIR when it is bound to one, else the server's default. Keyed by the real path,
 *  which is what Claude Code looks the folder up by. Call only once ensureDropsDir has returned a
 *  directory: that is what established the root is a private directory of ours and not a link. */
export function markDropsRootTrusted(sessionId: string): void {
  const configDir = accountSpawnEnv("claude", sessionId).CLAUDE_CONFIG_DIR;
  markDropsRoot(claudeUserConfigFile(configDir), claudeProjectPath(DROPS_ROOT));
}
