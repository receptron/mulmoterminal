// The GUI MCP registration for `agy`, written where agy actually reads one per project:
// `.agents/mcp_config.json` (its workspace customization dir, discovered by walking up from the
// session's cwd).
//
// claude and codex are handed a per-session URL at spawn — `--mcp-config`, `-c mcp_servers.…`.
// agy has no such flag: it reads a FILE. That file is per DIRECTORY and shared by every session
// running there, which decides how the two moving parts are split:
//
//   - the TOOL GROUP is a property of the directory, so it goes in the entry's own `env`;
//   - the SESSION is not, so it never appears here. It reaches the bridge through the agy
//     process's environment (guiMcpEnv, set per spawn) and only there.
//
// A session id written into this file would be handed to every later session in the directory,
// which is precisely how this broke before: one stale id, minted once and then frozen, sent every
// session's tool results to a channel nobody was listening on.
//
// Claude Code's own config remains the registry of WHICH groups a directory has (see
// infra/gui-mcp-registration.ts) — one switch in the launcher, every agent. This file is derived
// from it and rewritten when a switch flips or an agy session starts; it is never read back to
// answer what is registered.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";
import { isRecord } from "../../common/isRecord.js";
import { symlinkFreeWriteTarget } from "../infra/symlink-guard.js";
import { bridgeCommand, OUR_GUI_SERVER_IDS } from "./gui-mcp-bridge.js";
import { excludeFromGit } from "./git-exclude.js";
import { assignOwn } from "../infra/own-assign.js";

/** agy's workspace customization dir. `.agent`/`_agents`/`_agent` are also accepted by agy; we write one. */
const CUSTOMIZATION_DIR = ".agents";

export const antigravityMcpConfigFile = (cwd: string): string => path.join(cwd, CUSTOMIZATION_DIR, "mcp_config.json");

export interface AntigravityMcpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// Ours to rewrite, so an entry for a group that was switched OFF is removed rather than left
// behind. Shared with grok's config-file path, which owes the user's file the same restraint —
// see gui-mcp-bridge.ts for which ids are in it and why the all-tools id is not.
const OUR_SERVER_IDS = OUR_GUI_SERVER_IDS;

// The merged `mcpServers` map: the user's own entries untouched, ours replaced by exactly the
// groups given. Pure, so the "never clobber a server we don't own" rule is testable without a
// filesystem.
export function mergeAntigravityMcpServers(existing: Record<string, unknown>, groups: readonly ToolGroup[]): Record<string, unknown> {
  const { command, args } = bridgeCommand();
  // `assignOwn` for cursor-mcp.ts's reason: `JSON.parse` can produce an OWN `__proto__` key, and
  // assigning that id runs the inherited setter instead of creating a property — dropping the
  // user's entry from the file we write back.
  const merged: Record<string, unknown> = {};
  for (const id of Object.keys(existing)) {
    if (!OUR_SERVER_IDS.has(id)) assignOwn(merged, id, existing[id]);
  }
  for (const group of groups) {
    const server: AntigravityMcpServer = { command, args, env: { MULMOTERMINAL_TOOL_GROUP: group } };
    assignOwn(merged, toolGroupServerId(group), server);
  }
  return merged;
}

// `mcpServers` read with own-property checks: a key like `constructor` in the user's file must
// not resolve through Object.prototype (same reason as common/toolGroups.ts).
function readMcpServers(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(parsed)) return null;
    const servers = Object.prototype.hasOwnProperty.call(parsed, "mcpServers") ? parsed.mcpServers : {};
    return isRecord(servers) ? { ...servers } : {};
  } catch {
    return null; // present but not JSON — someone else's file, and rewriting it would lose it
  }
}

// Kept out of the user's `git status` — see git-exclude.ts for why it is `.git/info/exclude` and
// not their `.gitignore`.
const EXCLUDE_ENTRY = `${CUSTOMIZATION_DIR}/mcp_config.json`;

// Point this directory's agy sessions at the GUI MCP for exactly `groups`. Idempotent, and safe
// to call on a directory that has none: the file is removed once nothing is left in it, so a
// project stops carrying a config for a feature it no longer has switched on.
export function syncAntigravityMcpConfig(cwd: string, groups: readonly ToolGroup[]): void {
  const file = antigravityMcpConfigFile(cwd);
  // Same guard as the skills config beside it: a checkout can commit `.agents` or the file
  // itself as a symlink to somewhere of the repo author's choosing, and every fs call below
  // follows links (symlink-guard.ts).
  if (!symlinkFreeWriteTarget(file)) return;
  const existing = readMcpServers(file);
  if (existing === null) return;
  const mcpServers = mergeAntigravityMcpServers(existing, groups);
  try {
    if (Object.keys(mcpServers).length === 0) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers }, null, 2) + "\n", "utf8");
    excludeFromGit(cwd, EXCLUDE_ENTRY);
  } catch (err) {
    // A read-only project is a reason for agy to have no GUI tools there, not for the session to
    // fail to start.
    console.warn(`[antigravity] could not write ${file}: ${err}`);
  }
}
