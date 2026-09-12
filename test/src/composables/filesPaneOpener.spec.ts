import { describe, it, expect, beforeEach, vi } from "vitest";
import { setFilesPaneOpener, openInFilesPane, tryOpenInPane } from "../../../src/composables/filesPaneOpener";

// #910. The seam between a clicked terminal path and the pane beside an enlarged cell.
// What matters is the FALLBACK: every "no" here has to leave the click for the route it had
// before, so the two decisions this module owns (can the pane render it, is it under this
// cell's directory) are asserted alongside the grid's own veto.
describe("tryOpenInPane", () => {
  const CWD = "/Users/me/proj";

  beforeEach(() => setFilesPaneOpener(null));

  it("hands a source path to the pane, relative to the cwd", () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane("/Users/me/proj/src/main.ts", CWD)).toBe(true);
    expect(opener).toHaveBeenCalledWith(CWD, "src/main.ts");
  });

  // The pane is CodeMirror plus a Markdown preview, so the rendered routes belong to it too —
  // these are exactly the paths that used to cost a browser tab.
  it.each(["notes.md", "data.json", "rows.csv", "rows.tsv", "src/main.ts", "log.txt"])("takes %s", (name) => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane(name, CWD)).toBe(true);
  });

  // A new tab is still the right answer for what the browser DISPLAYS: the pane cannot render
  // these, and a tab shows them properly.
  it.each(["shot.png", "paper.pdf", "clip.mp4"])("declines %s, leaving it to the raw route", (name) => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane(name, CWD)).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  // But a tab is NOT a view for a type the browser cannot display — it is a download that starts
  // with no warning (#2038). `archive.zip` moved out of the list above for exactly that: the pane
  // shows no empty editor now, it says the file cannot be previewed and offers to open it in the
  // application that owns it.
  it.each(["archive.zip", "book.xlsx", "report.docx"])("takes %s, which a tab would only download", (name) => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane(name, CWD)).toBe(true);
  });

  it("declines a path outside the cell's directory — the pane cannot walk above its root", () => {
    const opener = vi.fn(() => true);
    setFilesPaneOpener(opener);
    expect(tryOpenInPane("/etc/hosts.ts", CWD)).toBe(false);
    expect(opener).not.toHaveBeenCalled();
  });

  // The grid declines when nothing is enlarged, or when the pane trails the zoom. Its "no"
  // has to reach the caller intact, or the click opens nowhere at all.
  it("passes the grid's own refusal through", () => {
    setFilesPaneOpener(() => false);
    expect(tryOpenInPane("src/main.ts", CWD)).toBe(false);
  });

  it("declines when no pane is registered at all (the single view)", () => {
    expect(tryOpenInPane("src/main.ts", CWD)).toBe(false);
    expect(openInFilesPane(CWD, "src/main.ts")).toBe(false);
  });

  // TerminalGrid clears the opener on unmount. Leaving a stale one registered would report
  // success for a click that reaches a pane no longer on screen.
  it("stops taking clicks once the opener is cleared", () => {
    setFilesPaneOpener(() => true);
    expect(tryOpenInPane("src/main.ts", CWD)).toBe(true);
    setFilesPaneOpener(null);
    expect(tryOpenInPane("src/main.ts", CWD)).toBe(false);
  });
});
