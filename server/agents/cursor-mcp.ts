// The GUI MCP registration for cursor, written where cursor actually reads one per project:
// `.cursor/mcp.json` in the session's working directory.
//
// CURSOR IS HALF agy AND HALF muse, which is the one thing that could not be guessed. It reads a
// FILE in the directory, as agy and grok do, and takes no `--mcp-config` of any kind — so the
// registration goes here. But it starts that server on a CURATED environment rather than its own,
// so the mechanism agy's entry leans on (the bridge inherits the agent's `guiMcpEnv`) does not
// happen: the GROUP and the PORT travel as ARGV, as muse's manifest does, and the SESSION is asked
// for through /api/mcp-resolve. A session id is never written here anyway — the file is shared by
// every cursor session in the directory and outlives them all.
//
// FOUR THINGS WERE MEASURED AGAINST cursor-agent 2026.09.10-fd3934a, because the hook loader in
// this same CLI answers the equivalent questions differently and guessing would have shipped a
// feature that silently does nothing:
//
//   0. THE CURATED ENVIRONMENT above, found by running the whole thing end to end: the file was
//      written and approved, and the cell still reported no MCP server. Which half arrived is the
//      proof — that attempt used agy's entry shape, with the group in the entry's own `env` block and
//      the port left to inheritance; the group arrived and the port did not, and the bridge refused
//      with "the mulmoterminal port is not set". Both are argv now.
//
//   1. The PROJECT file loads in the interactive TUI, which is what a cell runs. (The hook file
//      does not: `--plugin-dir` delivers hooks in `-p` print mode only, which is why
//      cursor-hooks-file.ts registers machine-globally instead. The MCP loader does NOT share that
//      trap — a probe server in `.cursor/mcp.json` was listed and called from a tmux TUI session.)
//
//   2. AN UNAPPROVED SERVER IS SILENTLY ABSENT. Not a prompt, not an error in the cell: the agent
//      is simply told there are no MCP servers ("namespace not found. Available namespaces: cursor"
//      / "No MCP servers available"). So writing the file is only half the work, and the half that
//      fails invisibly.
//
//   3. Approval is recorded PER PROJECT, in `~/.cursor/projects/<slug>/mcp-approvals.json`, as
//      `<server id>-<hash of that server's config>`. The hash is why this runs on every spawn
//      rather than once: change the bridge's argv and the recorded approval no longer matches, and
//      the tools vanish with no error anywhere.
//
// WHY NOT `--approve-mcps`. The flag exists and is one word instead of a subprocess — and it
// approves EVERY server in the user's file, including ones they deliberately left unapproved, and
// it persists that into the same per-project file. `cursor-agent mcp enable <id>` approves exactly
// the ids we wrote. Measured at ~0.4s, idempotent (a second call says "already enabled and
// approved"), and skipped entirely for a directory with no registered groups.
//
// Claude Code's own config remains the registry of WHICH groups a directory has (see
// infra/gui-mcp-registration.ts) — one switch in the launcher, every agent. This file is derived
// from it and rewritten when a switch flips or a cursor session starts; it is never read back to
// answer what is registered.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";
import { isRecord } from "../../common/isRecord.js";
import { symlinkFreeWriteTarget } from "../infra/symlink-guard.js";
import { bridgeCommand, OUR_GUI_SERVER_IDS } from "./gui-mcp-bridge.js";
import { excludeFromGit } from "./git-exclude.js";
import { assignOwn } from "../infra/own-assign.js";
import { cursorAdapter } from "./cursor.js";
import { PORT } from "../config/env.js";

const execFileAsync = promisify(execFile);

/** Cursor's per-project MCP file. `~/.cursor/mcp.json` is the user-level one and is theirs. */
export const cursorMcpConfigFile = (cwd: string): string => path.join(cwd, ".cursor", "mcp.json");

const EXCLUDE_ENTRY = ".cursor/mcp.json";

/** How long one `mcp enable` may take before the cell starts without it. Generous against a cold
 *  binary, short enough that four of them cannot hold a spawn open. */
const APPROVE_TIMEOUT_MS = 15_000;

export interface CursorMcpServer {
  command: string;
  args: string[];
}

/** The merged `mcpServers` map: the user's own entries untouched, ours replaced by exactly the
 *  groups given. Pure, so "never clobber a server we don't own" is testable without a filesystem.
 *
 *  THE GROUP AND THE PORT ARE ARGV, not an `env` block, and that is muse's shape rather than agy's
 *  for a measured reason: cursor starts an MCP server on a CURATED environment, so the one thing
 *  agy's entry relies on — the agent's own environment reaching its child — does not happen here
 *  (bridge-session.ts has the measurement). What is ours is the command line.
 *
 *  The SESSION is still absent, as it is from every file in a directory: it is shared by every
 *  cursor session running there and outlives all of them. The bridge asks this server which session
 *  it is running under instead (/api/mcp-resolve). */
export function mergeCursorMcpServers(existing: Record<string, unknown>, groups: readonly ToolGroup[], port: string | number): Record<string, unknown> {
  const bridge = bridgeCommand();
  // `assignOwn`, not `merged[id] = …`: `JSON.parse` can hand us an OWN `__proto__` key, and
  // assigning THAT id runs Object.prototype's setter instead of creating a property — so the user's
  // server would silently vanish from the file we write back (CodeRabbit on #2070).
  const merged: Record<string, unknown> = {};
  for (const id of Object.keys(existing)) {
    if (!OUR_GUI_SERVER_IDS.has(id)) assignOwn(merged, id, existing[id]);
  }
  for (const group of groups) {
    const server: CursorMcpServer = {
      command: bridge.command,
      args: [...bridge.args, "--group", group, "--port", String(port)],
    };
    assignOwn(merged, toolGroupServerId(group), server);
  }
  return merged;
}

// `mcpServers` read with own-property checks: a key like `constructor` in the user's file must not
// resolve through Object.prototype (same reason as common/toolGroups.ts).
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

/** Write the file. Returns the ids we registered, which is what then needs approving. */
export function syncCursorMcpConfig(cwd: string, groups: readonly ToolGroup[], port: string | number = PORT): string[] {
  const file = cursorMcpConfigFile(cwd);
  // Same guard as agy's: a checkout can commit `.cursor` or the file itself as a symlink to
  // somewhere of the repo author's choosing, and every fs call below follows links.
  if (!symlinkFreeWriteTarget(file)) return [];
  const existing = readMcpServers(file);
  if (existing === null) return [];
  // Read BEFORE the write, because the answer is "did this file exist without us" — see the
  // exclusion note below.
  const ours = !existsSync(file);
  const mcpServers = mergeCursorMcpServers(existing, groups, port);
  try {
    if (Object.keys(mcpServers).length === 0) {
      rmSync(file, { force: true });
      return [];
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers }, null, 2) + "\n", "utf8");
    // Kept out of `git status` only when the file is OURS — i.e. it did not exist before this sync.
    // Grok's rule rather than agy's, and for grok's reason: `.cursor/mcp.json` is a project config
    // a team may well have committed on purpose, and excluding a tracked file someone else wrote
    // would hide their own edits to it from them.
    if (ours) excludeFromGit(cwd, EXCLUDE_ENTRY);
    return groups.map(toolGroupServerId);
  } catch (err) {
    // A read-only project is a reason for cursor to have no GUI tools there, not for the session to
    // fail to start.
    console.warn(`[cursor] could not write ${file}: ${err}`);
    return [];
  }
}

/** Approve exactly the ids we wrote, in this directory. See the header for why this is not
 *  `--approve-mcps` and why it runs on every spawn rather than once. */
export async function approveCursorMcpServers(cwd: string, serverIds: readonly string[]): Promise<void> {
  await Promise.all(
    serverIds.map(async (id) => {
      try {
        await execFileAsync(cursorAdapter.bin(), ["mcp", "enable", id], { cwd, timeout: APPROVE_TIMEOUT_MS });
      } catch (err) {
        // No cursor-agent on PATH, or a directory it refuses: the cell still starts, with whatever
        // MCP the user configured themselves. Logged because the symptom otherwise is tools that
        // are simply missing.
        console.warn(`[cursor] could not approve MCP server ${id} in ${cwd}: ${err}`);
      }
    }),
  );
}

/** Point this directory's cursor sessions at the GUI MCP for exactly `groups`: write the file, then
 *  approve what was written. Both halves are required — an unapproved entry is invisible to the
 *  agent, with no prompt and no error. */
export async function syncCursorDirectoryMcp(cwd: string, groups: readonly ToolGroup[]): Promise<void> {
  const ids = syncCursorMcpConfig(cwd, groups);
  if (ids.length === 0) return;
  await approveCursorMcpServers(cwd, ids);
}
