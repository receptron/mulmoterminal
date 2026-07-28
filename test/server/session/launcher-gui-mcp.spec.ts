import { describe, it, expect } from "vitest";
import { launcherProgram, launcherCommandWithGuiMcp } from "../../../server/session/launcher-gui-mcp.js";

// The "Codex" launcher chip and the Claude|Codex agent toggle land in the same grid cell and look
// the same, but the chip runs a COMMAND STRING through the login shell — there is no argv to add
// the GUI MCP to. The first "Canvas doesn't light up for codex" report was exactly this.
const SERVERS = [
  { id: "mulmoterminal-render", url: "http://127.0.0.1:34567/api/mcp/render/s1", autoApprove: true },
  { id: "mulmoterminal-media", url: "http://127.0.0.1:34567/api/mcp/media/s1", autoApprove: false },
];

const rewrite = (command: string, servers = SERVERS) => launcherCommandWithGuiMcp(command, servers, "darwin");

describe("launcherProgram", () => {
  it("ignores the path and a Windows extension", () => {
    expect(launcherProgram("codex")).toBe("codex");
    expect(launcherProgram("/opt/homebrew/bin/codex --model gpt-5")).toBe("codex");
    expect(launcherProgram("codex.cmd")).toBe("codex");
    expect(launcherProgram("  codex  ")).toBe("codex");
  });

  // An unrecognised shape means "leave it alone" — this rewrites the user's own command, so
  // guessing at env prefixes or quoting is the wrong direction.
  it("does not try to see through a wrapper", () => {
    expect(launcherProgram("FOO=1 codex")).not.toBe("codex");
    expect(launcherProgram("$SHELL")).toBe("$SHELL");
  });
});

describe("launcherCommandWithGuiMcp", () => {
  it("adds each server's url, and the approval only where it was granted", () => {
    expect(rewrite("codex")).toBe(
      `codex -c 'mcp_servers.mulmoterminal-render.url="http://127.0.0.1:34567/api/mcp/render/s1"' ` +
        `-c 'mcp_servers.mulmoterminal-render.default_tools_approval_mode="approve"' ` +
        `-c 'mcp_servers.mulmoterminal-media.url="http://127.0.0.1:34567/api/mcp/media/s1"'`,
    );
  });

  // codex's clap layout takes global options BEFORE the subcommand, so appending would break
  // `codex resume`. The user's own text after the program is put back byte for byte.
  it("inserts the flags after the program and keeps the rest verbatim", () => {
    const out = rewrite(`codex --model "gpt 5" resume`);
    expect(out.startsWith("codex -c ")).toBe(true);
    expect(out.endsWith(` --model "gpt 5" resume`)).toBe(true);
  });

  // The inner double quotes are codex's — `-c key="value"` is parsed as TOML and the value stops
  // being a string without them — so the whole thing has to survive as ONE shell word.
  it("wraps each override in a single shell word", () => {
    const words = rewrite("codex").match(/'[^']*'/g) ?? [];
    expect(words).toHaveLength(3);
    for (const word of words) expect(word).toContain('="');
  });

  it("leaves a command that is not codex alone", () => {
    expect(rewrite("$SHELL")).toBe("$SHELL");
    expect(rewrite("claude")).toBe("claude");
    expect(rewrite("FOO=1 codex")).toBe("FOO=1 codex");
  });

  // A directory that registered nothing must run the command the user configured, unchanged.
  it("leaves codex alone when the directory registered no groups", () => {
    expect(launcherCommandWithGuiMcp("codex", [], "darwin")).toBe("codex");
  });

  // Windows runs the command through powershell, which doubles a quote instead of escaping it.
  it("quotes for the platform it will run on", () => {
    const out = launcherCommandWithGuiMcp("codex", [SERVERS[0]], "win32");
    expect(out).toContain(`-c 'mcp_servers.mulmoterminal-render.url="http://127.0.0.1:34567/api/mcp/render/s1"'`);
  });
});
