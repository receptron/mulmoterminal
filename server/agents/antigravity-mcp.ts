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
import { fileURLToPath } from "node:url";
import { TOOL_GROUPS, toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";

/** agy's workspace customization dir. `.agent`/`_agents`/`_agent` are also accepted by agy; we write one. */
const CUSTOMIZATION_DIR = ".agents";

// The absolute path of the node running THIS server, not the name `node`: the bridge is spawned
// by agy, whose PATH is the user's login shell's and need not have the same node (nvm) on it.
const bridgeCommand = (): { command: string; args: string[] } => ({
  command: process.execPath,
  args: [fileURLToPath(new URL("../mcp/bridge.mjs", import.meta.url))],
});

export const antigravityMcpConfigFile = (cwd: string): string => path.join(cwd, CUSTOMIZATION_DIR, "mcp_config.json");

export interface AntigravityMcpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// Ours to rewrite, so an entry for a group that was switched OFF is removed rather than left
// behind. `mulmoterminal-gui` is not a group id: it is the all-tools entry an earlier version of
// this wrote, and cleaning it up here is what stops it outliving the code that made it.
const OUR_SERVER_IDS = new Set(["mulmoterminal-gui", ...TOOL_GROUPS.map(toolGroupServerId)]);

// The merged `mcpServers` map: the user's own entries untouched, ours replaced by exactly the
// groups given. Pure, so the "never clobber a server we don't own" rule is testable without a
// filesystem.
export function mergeAntigravityMcpServers(existing: Record<string, unknown>, groups: readonly ToolGroup[]): Record<string, unknown> {
  const { command, args } = bridgeCommand();
  const merged: Record<string, unknown> = {};
  for (const id of Object.keys(existing)) {
    if (!OUR_SERVER_IDS.has(id)) merged[id] = existing[id];
  }
  for (const group of groups) {
    merged[toolGroupServerId(group)] = { command, args, env: { MULMOTERMINAL_TOOL_GROUP: group } } satisfies AntigravityMcpServer;
  }
  return merged;
}

// `mcpServers` read with own-property checks: a key like `constructor` in the user's file must
// not resolve through Object.prototype (same reason as common/toolGroups.ts).
function readMcpServers(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const servers = Object.prototype.hasOwnProperty.call(parsed, "mcpServers") ? (parsed as Record<string, unknown>).mcpServers : {};
    return servers && typeof servers === "object" && !Array.isArray(servers) ? { ...(servers as Record<string, unknown>) } : {};
  } catch {
    return null; // present but not JSON — someone else's file, and rewriting it would lose it
  }
}

// Keep the file we write out of the user's `git status`, through `.git/info/exclude` rather than
// their `.gitignore`: this is a local switch on a local machine, so it must not turn up in a diff
// or be pushed to their team — the same reason claude's registration uses `-s local` scope
// (infra/gui-mcp-registration.ts).
//
// Only when `.git/info` is really there: a worktree or a submodule keeps `.git` as a FILE pointing
// elsewhere, and a session can also run in a directory below the repo root, where this path means
// nothing. Both are left alone rather than guessed at — the cost is a line in `git status`, not a
// broken session.
const EXCLUDE_ENTRY = `${CUSTOMIZATION_DIR}/mcp_config.json`;

function excludeFromGit(cwd: string): void {
  const exclude = path.join(cwd, ".git", "info", "exclude");
  try {
    if (!existsSync(path.dirname(exclude))) return;
    const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (current.split("\n").includes(EXCLUDE_ENTRY)) return;
    writeFileSync(exclude, current + (current === "" || current.endsWith("\n") ? "" : "\n") + EXCLUDE_ENTRY + "\n", "utf8");
  } catch {
    // Not ours to insist on. The config itself is already written; this only affects tidiness.
  }
}

// Point this directory's agy sessions at the GUI MCP for exactly `groups`. Idempotent, and safe
// to call on a directory that has none: the file is removed once nothing is left in it, so a
// project stops carrying a config for a feature it no longer has switched on.
export function syncAntigravityMcpConfig(cwd: string, groups: readonly ToolGroup[]): void {
  const file = antigravityMcpConfigFile(cwd);
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
    excludeFromGit(cwd);
  } catch (err) {
    // A read-only project is a reason for agy to have no GUI tools there, not for the session to
    // fail to start.
    console.warn(`[antigravity] could not write ${file}: ${err}`);
  }
}
