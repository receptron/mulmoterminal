// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Terminal } from "@xterm/headless";
import { terminalModePrefix } from "../../../server/session/terminal-replay";
import { parseTmuxTerminalModes } from "../../../server/infra/tmux";
import { swallowsMouseTracking } from "../../../src/composables/mouseTrackingModes";
import { recordSwallowedModes, wantsMouseReports } from "../../../src/composables/mouseReports";

// Does the server's reattach prefix actually switch the wheel back on? (#1073)
//
// It lives under test/server/ despite driving a src/ rule, for the reason given in
// notify-kind-from-server.spec.ts: these modules are pure TypeScript, so they run under node.
//
// The unit specs on either side can both pass while the fix does nothing. The prefix has to
// survive the CLIENT's parser, which deliberately drops mouse-tracking SETs (#729) and records
// them instead — so the same bytes must end up in two different places: 1049 applied by xterm,
// 1000/1002/1003/1006 swallowed into the record the wheel and click synthesis read (#737/#845).
// Get that split wrong and the replay restores a terminal that still ignores the wheel, which is
// exactly the bug. So this runs the real prefix through the real handlers on a real terminal.

const write = (term: Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));

// Mirrors guardMouseTracking() in src/composables/useTerminalConnections.ts.
function attachGuard(term: Terminal): Set<number> {
  const swallowedMouseModes = new Set<number>();
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    const swallowed = swallowsMouseTracking(params);
    if (swallowed) recordSwallowedModes(swallowedMouseModes, params);
    return swallowed;
  });
  return swallowedMouseModes;
}

// The gate both mouse handlers answer to — src/composables/terminalMouseInput.ts.
const reportsMouseToApp = (term: Terminal, modes: ReadonlySet<number>): boolean => term.buffer.active.type === "alternate" && wantsMouseReports(modes);

// What tmux reports for a Claude Code pane: alternate buffer, any-motion tracking, SGR encoding.
const CLAUDE_PANE = "1,0,0,1,0,1";
const SHELL_PANE = "0,0,0,0,0,0";

describe("restoring a reattached session's terminal modes", () => {
  // The bug: a reattach replays a tail that no longer contains the startup `?1049h`, so the
  // browser sits in the normal buffer and the gate is false however much the user scrolls.
  it("leaves the wheel disconnected when the replay carries no modes", async () => {
    const term = new Terminal({ allowProposedApi: true });
    const modes = attachGuard(term);
    await write(term, "a Claude turn from the middle of the stream\r\n");
    expect(reportsMouseToApp(term, modes)).toBe(false);
    term.dispose();
  });

  it("hands the wheel back when the prefix goes in ahead of the same replay", async () => {
    const term = new Terminal({ allowProposedApi: true });
    const modes = attachGuard(term);
    await write(term, terminalModePrefix(parseTmuxTerminalModes(CLAUDE_PANE)) + "a Claude turn from the middle of the stream\r\n");
    expect(reportsMouseToApp(term, modes)).toBe(true);
    term.dispose();
  });

  it("puts each mode where it belongs: 1049 applied, the mouse modes swallowed", async () => {
    const term = new Terminal({ allowProposedApi: true });
    const modes = attachGuard(term);
    await write(term, terminalModePrefix(parseTmuxTerminalModes(CLAUDE_PANE)));
    expect(term.buffer.active.type).toBe("alternate");
    expect([...modes].sort()).toEqual([1003, 1006]);
    // Swallowed means xterm itself never tracks the mouse — a drag stays a text selection (#729).
    expect(term.modes.mouseTrackingMode).toBe("none");
    term.dispose();
  });

  it("restores nothing for a plain shell pane, which owns the normal buffer and its scrollback", async () => {
    const term = new Terminal({ allowProposedApi: true });
    const modes = attachGuard(term);
    await write(term, terminalModePrefix(parseTmuxTerminalModes(SHELL_PANE)) + "$ ls\r\n");
    expect(term.buffer.active.type).toBe("normal");
    expect(reportsMouseToApp(term, modes)).toBe(false);
    term.dispose();
  });
});
