// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { revealArgv } from "../../../server/files/reveal-argv.js";

// The point of the feature is DRAG AND DROP: the file has to end up selected in a window the user
// can drag out of (#2039). Every platform is asserted here because the interesting branch is
// always the one the developer's machine cannot run.
describe("revealArgv", () => {
  const FILE = "/work/ws/reports/2026-08.pdf";

  it("selects the file on macOS", () => {
    expect(revealArgv("open", FILE, false)).toEqual(["-R", FILE]);
  });

  // Explorer parses `/select,<path>` as ONE token; passing the flag separately opens the user's
  // home folder instead of selecting anything.
  it("selects the file on Windows, under both spellings of Explorer", () => {
    expect(revealArgv("explorer", "C:\\work\\a.pdf", false)).toEqual(["/select,C:\\work\\a.pdf"]);
    expect(revealArgv("explorer.exe", "C:\\work\\a.pdf", false)).toEqual(["/select,C:\\work\\a.pdf"]);
  });

  // No Linux file manager has a portable "select this item", so the folder is as close as it gets.
  it("opens the containing folder on Linux, since it cannot select", () => {
    expect(revealArgv("xdg-open", FILE, false)).toEqual(["/work/ws/reports"]);
  });

  // The row the user right-clicked IS the folder they want in front of them — revealing it would
  // open its PARENT with the folder merely highlighted.
  it("opens a directory itself on every platform, rather than selecting it in its parent", () => {
    for (const cmd of ["open", "explorer", "explorer.exe", "xdg-open"]) {
      expect(revealArgv(cmd, "/work/ws/reports", true)).toEqual(["/work/ws/reports"]);
    }
  });

  // An argv array, never a command line: these are one argument each and reach the file manager
  // intact. A shell would have read the first as two words and the second as a statement end.
  it.each(['/work/a file with "quotes".pdf', "/work/a;rm -rf x.pdf", "/work/$(whoami).pdf", "/work/a\nb.pdf"])(
    "passes %j through as a single argument",
    (name) => {
      expect(revealArgv("open", name, false)).toEqual(["-R", name]);
      expect(revealArgv("explorer", name, false)).toEqual([`/select,${name}`]);
      expect(revealArgv("xdg-open", name, false)).toEqual([path.dirname(name)]);
    },
  );

  // An opener this module has not heard of is treated as "cannot select" rather than handed a
  // flag it would print usage for. The list comes from `openDirCommands`, so this is the two
  // halves of the pair disagreeing — which is exactly when a silent wrong answer is worst.
  it("falls back to the containing folder for an opener it does not know", () => {
    expect(revealArgv("nautilus", FILE, false)).toEqual(["/work/ws/reports"]);
  });
});
