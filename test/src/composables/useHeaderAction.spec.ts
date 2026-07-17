import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  filesGotoIndex: vi.fn(),
  prsGotoIndex: vi.fn(),
  wikiGotoIndex: vi.fn(),
  browseGotoIndex: vi.fn(),
  accountingViewOpen: vi.fn(),
  submitText: vi.fn(),
  insertText: vi.fn(),
  openTerminalAt: vi.fn(),
}));
vi.mock("./useFilesView", () => ({ filesGotoIndex: m.filesGotoIndex }));
vi.mock("./usePrsView", () => ({ prsGotoIndex: m.prsGotoIndex }));
vi.mock("./useWikiBrowse", () => ({ wikiGotoIndex: m.wikiGotoIndex }));
vi.mock("./useCollectionBrowse", () => ({ browseGotoIndex: m.browseGotoIndex }));
vi.mock("./useAccountingView", () => ({ accountingViewOpen: m.accountingViewOpen }));
vi.mock("./useTerminalConnections", () => ({ submitText: m.submitText, insertText: m.insertText }));
vi.mock("./useNewTerminal", () => ({ openTerminalAt: m.openTerminalAt }));

import { runHeaderButton } from "../../../src/composables/useHeaderAction";
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
    runHeaderButton(btn({ run: "open", open: { view: "prs" } }), null, null);
    expect(m.prsGotoIndex).toHaveBeenCalled();
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

  it("open pickFile without a slot key is a no-op (no dialog)", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    runHeaderButton(btn({ run: "open", open: { pickFile: true } }), null, null);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shell → defensive no-op warn (Terminal.vue emits `run` instead; server suppresses shell here)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runHeaderButton(btn({ run: "shell" }), "single", "/x");
    expect(m.submitText).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
