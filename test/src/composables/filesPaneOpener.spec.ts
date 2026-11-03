import { describe, it, expect, beforeEach, vi } from "vitest";
import { setFilesPaneOpener, openInFilesPane, tryOpenInPane } from "../../../src/composables/filesPaneOpener";

// #910. The seam between a clicked terminal path and the grid's right pane.
// What matters is the FALLBACK: every "no" here has to leave the click for the route it had
// before, so the two decisions this module owns (can the pane render it, is it under this
// cell's directory) are asserted alongside the grid's own veto.
describe("tryOpenInPane", () => {
  const CWD = "/Users/me/proj";

  beforeEach(() => setFilesPaneOpener(null));

  it("hands a source path to the pane, relative to the cwd", () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane("/Users/me/proj/src/main.ts", CWD, undefined, false, "s1")).toBe(true);
    expect(opener).toHaveBeenCalledWith(CWD, "src/main.ts", undefined, false, "s1");
  });

  // #2573. The line an agent named after the path rides along to the pane.
  it("hands the pane the location named after the path", () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane("src/main.ts", CWD, { line: 42, col: 7 }, false, "s1")).toBe(true);
    expect(opener).toHaveBeenCalledWith(CWD, "src/main.ts", { line: 42, col: 7 }, false, "s1");
  });

  // #3005. Cmd/Ctrl on the terminal click reaches the pane as "open in a new tab".
  it("hands the pane the new-tab request, with or without a location", () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane("src/main.ts", CWD, undefined, true, "s1")).toBe(true);
    expect(tryOpenInPane("src/main.ts", CWD, { line: 42, col: null }, true, "s1")).toBe(true);
    expect(opener.mock.calls).toEqual([
      [CWD, "src/main.ts", undefined, true, "s1"],
      [CWD, "src/main.ts", { line: 42, col: null }, true, "s1"],
    ]);
  });

  // The pane is CodeMirror plus a Markdown preview, so the rendered routes belong to it too —
  // these are exactly the paths that used to cost a browser tab.
  it.each(["notes.md", "data.json", "rows.csv", "rows.tsv", "src/main.ts", "log.txt"])("takes %s", (name) => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane(name, CWD, undefined, false, "s1")).toBe(true);
  });

  // #2269: what an agent draws — a chart as a PNG, an SVG, an HTML report — stays in the grid.
  it.each(["shot.png", "chart.svg", "report.html", "page.htm"])("takes %s into the pane", (name) => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane(name, CWD, undefined, false, "s1")).toBe(true);
    expect(opener).toHaveBeenCalledWith(CWD, name, undefined, false, "s1");
  });

  // #2674: a PDF, a video and a sound are drawn in the pane too, from the same raw route a tab used.
  it.each(["paper.pdf", "clip.mp4", "memo.m4a"])("takes %s into the pane", (name) => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane(name, CWD, undefined, false, "s1")).toBe(true);
    expect(opener).toHaveBeenCalledWith(CWD, name, undefined, false, "s1");
  });

  it("leaves a PDF to its tab when no pane is open", () => {
    setFilesPaneOpener(null);
    expect(tryOpenInPane("paper.pdf", CWD, undefined, false, "s1")).toBe(false);
  });

  // But a tab is NOT a view for a type the browser cannot display — it is a download that starts
  // with no warning (#2038). `archive.zip` moved out of the list above for exactly that: the pane
  // shows no empty editor now, it says the file cannot be previewed and offers to open it in the
  // application that owns it.
  it.each(["archive.zip", "book.xlsx", "report.docx"])("takes %s, which a tab would only download", (name) => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane(name, CWD, undefined, false, "s1")).toBe(true);
  });

  // #3238. The cell the click came from rides along, so the tiled grid can open the pane beside IT;
  // a terminal with no session yet says so with null rather than being dropped.
  it("hands the pane the session the click came from, null included", () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane("src/main.ts", CWD, undefined, false, null)).toBe(true);
    expect(opener).toHaveBeenLastCalledWith(CWD, "src/main.ts", undefined, false, null);
  });

  it("declines a path outside the cell's directory — the pane cannot walk above its root", () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane("/etc/hosts.ts", CWD, undefined, false, "s1")).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  // The grid declines when there is no room for the pane, or when the pane trails the zoom. Its "no"
  // has to reach the caller intact, or the click opens nowhere at all.
  it("passes the grid's own refusal through", () => {
    setFilesPaneOpener(() => false);
    expect(tryOpenInPane("src/main.ts", CWD, undefined, false, "s1")).toBe(false);
  });

  it("declines when no pane is registered at all (the single view)", () => {
    expect(tryOpenInPane("src/main.ts", CWD, undefined, false, "s1")).toBe(false);
    expect(openInFilesPane(CWD, "src/main.ts", undefined, false, "s1")).toBe(false);
  });

  // TerminalGrid clears the opener on unmount. Leaving a stale one registered would report
  // success for a click that reaches a pane no longer on screen.
  it("stops taking clicks once the opener is cleared", () => {
    setFilesPaneOpener(() => true);
    expect(tryOpenInPane("src/main.ts", CWD, undefined, false, "s1")).toBe(true);
    setFilesPaneOpener(null);
    expect(tryOpenInPane("src/main.ts", CWD, undefined, false, "s1")).toBe(false);
  });
});
