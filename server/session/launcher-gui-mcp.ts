// Giving a LAUNCHER's codex the same GUI tools the agent toggle's codex gets.
//
// A launcher is a command string the user configured (`{label: "Codex", command: "codex"}`), run
// through the login shell — so unlike the first-class codex path there is no argv to add to, only
// text. The two look alike in the grid and land in the same cell, and a Canvas that lights up for
// one and never for the other reads as a broken feature; that is exactly how it was first
// reported.
//
// Only codex is touched, and only when it is the program being run. Everything else — a shell, a
// REPL, another agent — is passed through untouched: this rewrites a command the user wrote, so it
// has to be a narrow, recognisable case rather than a guess.
import path from "node:path";
import { shellQuoteFor } from "../config/header-resolve.js";
import type { GuiMcpServer } from "../agents/codex-args.js";

// The program a command line runs, without its directory or a Windows extension: `codex`,
// `/opt/homebrew/bin/codex` and `codex.cmd` are the same program. A quoted or env-prefixed
// invocation (`FOO=1 codex`, `"my codex"`) is deliberately NOT unwrapped — an unrecognised shape
// means "leave it alone", which is the safe direction for rewriting someone's own command.
export function launcherProgram(command: string): string {
  const [first = ""] = command.trim().split(/\s+/, 1);
  return path.basename(first).replace(/\.(exe|cmd|bat)$/i, "");
}

/**
 * The command to actually run, with codex's MCP overrides inserted when this launcher runs codex.
 *
 * The flags go directly after the program: codex's clap layout takes global options before the
 * subcommand, so appending them at the end would break `codex resume`-style invocations.
 */
export function launcherCommandWithGuiMcp(command: string, servers: readonly GuiMcpServer[], platform: NodeJS.Platform): string {
  if (servers.length === 0 || launcherProgram(command) !== "codex") return command;
  const quote = shellQuoteFor(platform);
  const flags = servers.flatMap((server) => {
    // Quoted as ONE shell word each, because this is text handed to a shell rather than an argv
    // element. The inner double quotes are codex's, not the shell's — `-c key="value"` is parsed
    // as TOML and the value stops being a string without them.
    const parts = [`-c`, quote(`mcp_servers.${server.id}.url="${server.url}"`)];
    if (server.autoApprove) parts.push(`-c`, quote(`mcp_servers.${server.id}.default_tools_approval_mode="approve"`));
    return parts;
  });
  // Sliced rather than split-and-rejoined: everything after the program is the user's text,
  // quoting and spacing included, and it is put back byte for byte.
  const trimmed = command.trim();
  const boundary = trimmed.search(/\s/);
  const program = boundary === -1 ? trimmed : trimmed.slice(0, boundary);
  const rest = boundary === -1 ? "" : trimmed.slice(boundary);
  return `${program} ${flags.join(" ")}${rest}`;
}
