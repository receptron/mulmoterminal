import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  filesGotoIndex: vi.fn(),
  githubGotoIndex: vi.fn(),
  wikiGotoIndex: vi.fn(),
  browseGotoIndex: vi.fn(),
  accountingViewOpen: vi.fn(),
  submitText: vi.fn(),
  insertText: vi.fn(),
  openTerminalAt: vi.fn(),
  runAppAction: vi.fn((action: string) => action.length > 0),
  requestGridCellAction: vi.fn((key: string | null, action: string) => key !== null && action.length > 0),
}));
vi.mock("../../../src/composables/useFilesView", () => ({ filesGotoIndex: m.filesGotoIndex }));
vi.mock("../../../src/composables/useGithubView", () => ({ githubGotoIndex: m.githubGotoIndex }));
vi.mock("../../../src/composables/useWikiBrowse", () => ({ wikiGotoIndex: m.wikiGotoIndex }));
vi.mock("../../../src/composables/useCollectionBrowse", () => ({ browseGotoIndex: m.browseGotoIndex }));
vi.mock("../../../src/composables/useAccountingView", () => ({ accountingViewOpen: m.accountingViewOpen }));
vi.mock("../../../src/composables/useTerminalConnections", () => ({ submitText: m.submitText, insertText: m.insertText }));
vi.mock("../../../src/composables/useNewTerminal", () => ({ openTerminalAt: m.openTerminalAt }));
vi.mock("../../../src/composables/runAppAction", () => ({ runAppAction: m.runAppAction }));
vi.mock("../../../src/composables/useGridCellAction", () => ({ requestGridCellAction: m.requestGridCellAction }));

import { runHeaderButton } from "../../../src/composables/useHeaderAction";
import { setRemoteServer, REMOTE_SERVER_DECLINE_EN } from "../../../src/composables/remoteServer";
import type { HeaderButton } from "../../../src/composables/useHeaderButtons";

const btn = (over: Partial<HeaderButton>): HeaderButton => ({ id: "x", label: "X", run: "open", ...over });

describe("runHeaderButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("input → submitText into the session's slot", () => {
    runHeaderButton(btn({ run: "input", text: "/compact" }), "single", "/x");
    expect(m.submitText).toHaveBeenCalledWith("single", "/compact");
  });

  it("input without a slot key is a no-op", () => {
    runHeaderButton(btn({ run: "input", text: "/compact" }), null, "/x");
    expect(m.submitText).not.toHaveBeenCalled();
  });

  it("open url → window.open for http(s), ignores other schemes", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    runHeaderButton(btn({ run: "open", open: { url: "https://x" } }), null, null);
    expect(open).toHaveBeenCalledWith("https://x", "_blank", "noopener,noreferrer");
    open.mockClear();
    runHeaderButton(btn({ run: "open", open: { url: "javascript:alert(1)" } }), null, null);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  // #2669 (experimental): the file manager would open on the server's screen.
  it("open reveal with remoteServer → says why and sends nothing", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const report = vi.fn();
    setRemoteServer(true);
    runHeaderButton(btn({ run: "open", open: { reveal: "/dir" } }), null, null, report);
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(REMOTE_SERVER_DECLINE_EN);
    expect(f).not.toHaveBeenCalled();
    setRemoteServer(false);
    vi.unstubAllGlobals();
  });

  it("open reveal → POST /api/open-dir", () => {
    const f = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal("fetch", f);
    runHeaderButton(btn({ run: "open", open: { reveal: "/dir" } }), null, null);
    expect(f).toHaveBeenCalledWith("/api/open-dir", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("open files → filesGotoIndex; open view routes to the matching nav (else files)", () => {
    runHeaderButton(btn({ run: "open", open: { files: "/dir" } }), null, null);
    expect(m.filesGotoIndex).toHaveBeenCalledWith("/dir");
    // `"prs"` stays the config value even though the view is now called GitHub: it is what users
    // have written in their own header configs, documented in both guides and the -header skill.
    runHeaderButton(btn({ run: "open", open: { view: "prs" } }), null, null);
    expect(m.githubGotoIndex).toHaveBeenCalled();
    runHeaderButton(btn({ run: "open", open: { view: "diff" } }), null, "/c");
    expect(m.filesGotoIndex).toHaveBeenLastCalledWith("/c");
  });

  it("open terminal → openTerminalAt with the dir and the triggering cell's slot key", () => {
    runHeaderButton(btn({ run: "open", open: { terminal: "/proj" } }), "cell-4", "/proj");
    expect(m.openTerminalAt).toHaveBeenCalledWith("/proj", "cell-4");
  });

  it("open pickFile → POST /api/pick-file, inserts the chosen path(s) into the slot", async () => {
    const f = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ paths: ["/a/b.ts"] }) } as unknown as Response));
    vi.stubGlobal("fetch", f);
    runHeaderButton(btn({ run: "open", open: { pickFile: true } }), "single", null);
    await vi.waitFor(() => expect(m.insertText).toHaveBeenCalled());
    expect(f).toHaveBeenCalledWith("/api/pick-file", expect.objectContaining({ method: "POST" }));
    expect(m.insertText).toHaveBeenCalledWith("single", expect.stringContaining("/a/b.ts"));
    vi.unstubAllGlobals();
  });

  // #1447: a host with no dialog answered 500 and this dropped it, so the button looked broken.
  // The message goes to the caller's banner, and nothing is typed into the session.
  it("open pickFile → reports the reason instead of inserting when no dialog opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "No file dialog on this host — install zenity" }), { status: 500 }))),
    );
    const report = vi.fn();
    runHeaderButton(btn({ run: "open", open: { pickFile: true } }), "single", null, report);
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.stringContaining("install zenity")));
    expect(m.insertText).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // The same silence on the reveal button: the route answered ok before the opener had started.
  it("open reveal → reports a folder that could not be opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "could not open /proj with xdg-open: ENOENT" }), { status: 500 }))),
    );
    const report = vi.fn();
    runHeaderButton(btn({ run: "open", open: { reveal: "/proj" } }), "single", null, report);
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.stringContaining("xdg-open")));
    vi.unstubAllGlobals();
  });

  it("open pickFile without a slot key is a no-op (no dialog)", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    runHeaderButton(btn({ run: "open", open: { pickFile: true } }), null, null);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("action → hands the action to the cell's handler, and says nothing when it was done", () => {
    const report = vi.fn();
    runHeaderButton(btn({ run: "action", action: "terminal-new-here" }), "cell-3", "/x", report);
    expect(m.requestGridCellAction).toHaveBeenCalledWith("cell-3", "terminal-new-here");
    expect(report).not.toHaveBeenCalled();
  });

  it("action → reports why when the cell declines, and ignores an action it does not know", () => {
    const report = vi.fn();
    m.requestGridCellAction.mockReturnValueOnce(false);
    runHeaderButton(btn({ run: "action", action: "terminal-talk" }), "cell-3", "/x", report);
    expect(report).toHaveBeenCalledWith("There is no other terminal to talk to.");

    runHeaderButton(btn({ run: "action", action: "reboot" }), "cell-3", "/x", report);
    expect(m.requestGridCellAction).toHaveBeenCalledTimes(1);

    m.requestGridCellAction.mockReturnValueOnce(false);
    runHeaderButton(btn({ run: "action", action: "pane-files" }), "single", "/x", report);
    expect(report).toHaveBeenLastCalledWith("This button acts on a terminal in the grid.");
  });

  // #2653: a grid cell declining a self action says why, rather than the outside-grid fallback.
  it.each([
    "terminal-copy-code",
    "terminal-insert-path",
    "terminal-reveal",
    "terminal-voice",
    "terminal-diff",
    "terminal-note",
    "terminal-send-turn",
    "terminal-send-since",
    "terminal-bring-turn",
    "terminal-bring-since",
  ])("action → %s declined in the grid names its own reason", (action) => {
    const report = vi.fn();
    m.requestGridCellAction.mockReturnValueOnce(false);
    runHeaderButton(btn({ run: "action", action }), "cell-3", "/x", report);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).not.toBe("This button acts on a terminal in the grid.");
  });

  it("action → runs a toolbar operation for the app, and says so when it is not available", () => {
    const report = vi.fn();
    runHeaderButton(btn({ run: "action", action: "screen-wiki" }), "cell-3", "/x", report);
    expect(m.runAppAction).toHaveBeenCalledWith("screen-wiki");
    expect(m.requestGridCellAction).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();

    m.runAppAction.mockReturnValueOnce(false);
    runHeaderButton(btn({ run: "action", action: "screen-prs" }), "cell-3", "/x", report);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("shell → defensive no-op warn (Terminal.vue emits `run` instead; server suppresses shell here)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runHeaderButton(btn({ run: "shell" }), "single", "/x");
    expect(m.submitText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
