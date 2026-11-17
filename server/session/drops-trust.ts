// The drops root marked trusted for Claude Code (#3313), so a cell handed its drop directory with
// --add-dir is not stopped at startup to approve it. The ROOT, not the session's directory: Claude
// Code accepts trust from an ancestor of a folder outside a git repository, so one entry covers every
// session, where one per session would grow the user's config with a key for each cell ever opened.
// Why trusting it is safe, and how the write is made, is own-folder-trust.ts.
import path from "node:path";
import { folderTrustMarker } from "../agents/claude/own-folder-trust.js";
import { claudeProjectPath, claudeUserConfigFile } from "./project-dir.js";
import { accountSpawnEnv } from "./session-home.js";
import { DROPS_ROOT } from "./session-drops.js";

const markDropsRoot = folderTrustMarker();

/** The root's key: the real path of the temp directory above it, which Claude Code resolves the
 *  same way, joined to the root's own name WITHOUT following it. Were the root swapped for a link
 *  after ensureDropsDir checked it, resolving the whole path would trust wherever the link points;
 *  this names only where the root belongs, which a link there would never be looked up as. */
export function dropsRootTrustKey(root: string = DROPS_ROOT): string {
  return path.join(claudeProjectPath(path.dirname(root)), path.basename(root));
}

/** Trust the drops root in the config of the login this session's claude runs on: its account's
 *  CLAUDE_CONFIG_DIR when it is bound to one, else the server's default. Call only once
 *  ensureDropsDir has returned a directory, so a root that is not ours is never named at all. */
export function markDropsRootTrusted(sessionId: string): void {
  const configDir = accountSpawnEnv("claude", sessionId).CLAUDE_CONFIG_DIR;
  markDropsRoot(claudeUserConfigFile(configDir), dropsRootTrustKey());
}
