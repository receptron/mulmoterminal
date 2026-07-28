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
import { spawnCapture } from "./spawnCapture.js";
import { toolGroupServerId, type ToolGroup } from "../../common/toolGroups.js";

export const guiMcpUrlTemplate = (group: ToolGroup): string => `http://127.0.0.1:\${MULMOTERMINAL_PORT}/api/mcp/${group}/\${MULMOTERMINAL_SESSION_ID}`;

export interface GuiMcpRegistration {
  ok: boolean;
  /** stdout+stderr from the CLI, so a failure can be shown rather than guessed at. */
  message: string;
}

// `cwd` is what makes it per-folder: local scope is keyed by the directory the CLI runs in.
function claudeMcp(bin: string, cwd: string, args: string[]): GuiMcpRegistration {
  // Both streams: the CLI explains a refusal on stderr, and "it failed" with an empty message
  // is the one thing this route must never answer.
  const { status, stdout, stderr } = spawnCapture(bin, ["mcp", ...args], cwd);
  return { ok: status === 0, message: [stdout, stderr].filter(Boolean).join("\n").trim() };
}

export function registerGuiMcpGroup(bin: string, cwd: string, group: ToolGroup): GuiMcpRegistration {
  const id = toolGroupServerId(group);
  // Remove first so re-enabling repairs a registration written against an older url (the
  // template changes only when the route does, but a user may also have edited it). `remove`
  // failing means it was not there, which is the normal case — its status is deliberately
  // ignored rather than reported as the operation's.
  claudeMcp(bin, cwd, ["remove", id, "-s", "local"]);
  return claudeMcp(bin, cwd, ["add", "-s", "local", "--transport", "http", id, guiMcpUrlTemplate(group)]);
}

export function unregisterGuiMcpGroup(bin: string, cwd: string, group: ToolGroup): GuiMcpRegistration {
  return claudeMcp(bin, cwd, ["remove", toolGroupServerId(group), "-s", "local"]);
}

// Which groups this directory has registered, read back from the CLI rather than remembered:
// the user can add or remove one with `claude mcp` behind our back, and a cached answer would
// then describe a directory that no longer exists as described.
export function registeredGuiMcpGroups(bin: string, cwd: string, groups: readonly ToolGroup[]): ToolGroup[] {
  const { status, stdout } = spawnCapture(bin, ["mcp", "list"], cwd);
  if (status !== 0) return [];
  return groups.filter((group) => listMentionsServer(stdout, toolGroupServerId(group)));
}

// `claude mcp list` prints `<id>: <command or url> - <status>` per line. Matched at the start of
// a line so a server whose URL happens to contain another group's id is not counted twice.
export function listMentionsServer(listOutput: string, serverId: string): boolean {
  return listOutput.split("\n").some((line) => line.trimStart().startsWith(`${serverId}:`));
}
