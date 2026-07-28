// Turning a directory's GUI tool group on and off, through Claude Code's OWN per-folder MCP
// config rather than a MulmoTerminal setting.
//
// MulmoTerminal deliberately stores nothing about this: `claude mcp add -s local` writes the
// registration into ~/.claude.json keyed by the directory, which is already the mechanism for
// "this folder gets that MCP server" — a second registry here would be one more place to look,
// with no approval gate and no `claude mcp list` to see it in.
//
// `local` scope, not `project`: it lands in the user's own file rather than a `.mcp.json`
// committed to their repo, so enabling a tool group for yourself never shows up in a diff.
//
// The url is a TEMPLATE, not a resolved address. Claude Code expands `${VAR}` in an MCP url at
// connect time, and the two moving parts (our port, the session id) are only known per spawn —
// they are set on each session's environment (see session/mcp-config.ts guiMcpEnv).
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnCaptureAsync } from "./spawnCapture.js";
import { toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";

export const guiMcpUrlTemplate = (group: ToolGroup): string => `http://127.0.0.1:\${MULMOTERMINAL_PORT}/api/mcp/${group}/\${MULMOTERMINAL_SESSION_ID}`;

export interface GuiMcpRegistration {
  ok: boolean;
  /** stdout+stderr from the CLI, so a failure can be shown rather than guessed at. */
  message: string;
}

// `cwd` is what makes it per-folder: local scope is keyed by the directory the CLI runs in.
async function claudeMcp(bin: string, cwd: string, args: string[]): Promise<GuiMcpRegistration> {
  // Both streams: the CLI explains a refusal on stderr, and "it failed" with an empty message
  // is the one thing this route must never answer.
  const { status, stdout, stderr } = await spawnCaptureAsync(bin, ["mcp", ...args], { cwd });
  return { ok: status === 0, message: [stdout, stderr].filter(Boolean).join("\n").trim() };
}

export async function registerGuiMcpGroup(bin: string, cwd: string, group: ToolGroup): Promise<GuiMcpRegistration> {
  const id = toolGroupServerId(group);
  // Remove first so re-enabling repairs a registration written against an older url (the
  // template changes only when the route does, but a user may also have edited it). `remove`
  // failing means it was not there, which is the normal case — its status is deliberately
  // ignored rather than reported as the operation's.
  await claudeMcp(bin, cwd, ["remove", id, "-s", "local"]);
  return claudeMcp(bin, cwd, ["add", "-s", "local", "--transport", "http", id, guiMcpUrlTemplate(group)]);
}

export function unregisterGuiMcpGroup(bin: string, cwd: string, group: ToolGroup): Promise<GuiMcpRegistration> {
  return claudeMcp(bin, cwd, ["remove", toolGroupServerId(group), "-s", "local"]);
}

// Claude Code's own config file, which is where `claude mcp add -s local` writes. It defaults to
// ~/.claude.json and moves WITH CLAUDE_CONFIG_DIR — a user who relocated their Claude Code config
// must not see every directory reported as having nothing registered.
const claudeConfigFile = (): string => path.join(process.env.CLAUDE_CONFIG_DIR?.trim() || homedir(), ".claude.json");

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    // Absent, unreadable or half-written (Claude Code rewrites this file live). Nothing
    // registered is the honest answer, and it is also the safe one: the switch renders OFF, and
    // turning it on re-registers rather than removing anything.
    return null;
  }
}

// `mcpServers` is a JSON object keyed by server id. Read with Object.keys on an own-property
// check rather than indexed lookups, so a key like `constructor` in the user's file cannot
// resolve through Object.prototype (same reason common/toolGroups.ts uses a Map).
const serverIdsIn = (value: unknown): string[] => (value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as object) : []);

const ownProp = (obj: unknown, key: string): unknown =>
  obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;

// The servers a scope holds. Every scope spells them the same way — `{ mcpServers: { <id>: … } }`
// — a per-directory entry under `projects` included.
const scopeServerIds = (scope: unknown): string[] => serverIdsIn(ownProp(scope, "mcpServers"));

// Which groups this directory has registered. Read from Claude Code's config FILES, not from
// `claude mcp list`: that command health-checks every registered server before it prints, which
// costs seconds of network round-trips (more when one of the user's servers is down) — and the
// launcher runs this every time it opens, so the Canvas switch appeared late and moved the rows
// under it. The files are the same source `claude mcp list` reads, minus the probing, so the
// answer still follows a registration the user made with the CLI behind our back.
//
// All three scopes, because that is what the CLI shows and what the session will actually get:
// local (ours, keyed by directory), project (`.mcp.json` in the repo), user (global).
export async function registeredGuiMcpGroups(cwd: string, groups: readonly ToolGroup[]): Promise<ToolGroup[]> {
  // Claude Code keys local scope by its OWN process.cwd(), which the OS resolves symlinks in,
  // while the path we are asked about is canonicalized only lexically (see existingWorkspace).
  // Both spellings are looked up so a directory reached through a symlink still matches.
  const [config, project, real] = await Promise.all([
    readJsonObject(claudeConfigFile()),
    readJsonObject(path.join(cwd, ".mcp.json")),
    realpath(cwd).catch(() => cwd),
  ]);
  const perDir = ownProp(config, "projects");
  const ids = new Set([
    ...scopeServerIds(config),
    ...scopeServerIds(ownProp(perDir, cwd)),
    ...(real === cwd ? [] : scopeServerIds(ownProp(perDir, real))),
    ...scopeServerIds(project),
  ]);
  return groups.filter((group) => ids.has(toolGroupServerId(group)));
}
