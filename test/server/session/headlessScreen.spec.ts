// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { renderScreen } from "../../../server/session/headlessScreen.js";
import { rowsToScreen } from "../../../server/session/screen-rows.js";

const ESC = String.fromCharCode(0x1b);

// renderScreen returns rows carrying each line's dim run alongside its text (#563);
// everything below this helper is about the text.
const screenOf = async (input: Parameters<typeof renderScreen>[0]): Promise<string> => rowsToScreen(await renderScreen(input)).trimEnd();

// @xterm/headless ships a UMD/CJS bundle whose `module` field points at a path that does
// not exist, so Node's ESM loader falls back to CJS and cannot see the named export. A
// bare `import { Terminal }` throws at STARTUP under `node --import tsx` — and this suite
// would never notice, because vitest resolves the package differently. Hence a source
// assertion rather than a behavioural one.
describe("headlessScreen module shape", () => {
  it("imports the emulator as a default, which is what real Node ESM can resolve", () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../server/session/headlessScreen.ts"), "utf-8");
    expect(source).toMatch(/import headless from "@xterm\/headless"/);
    expect(source).not.toMatch(/import \{[^}]*Terminal[^}]*\} from "@xterm\/headless"/);
  });
});

describe("renderScreen", () => {
  // The whole point: a byte stream is not a screen until an emulator has run it.
  it("renders the screen a stream would produce, not the stream", async () => {
    const buffer = `${ESC}[31mRED${ESC}[0m plain\r\nsecond`;
    expect(await screenOf({ buffer, cols: 40, rows: 5 })).toBe("RED plain\nsecond");
  });

  // Reading buffer.active before term.write's callback yields an empty screen — the
  // regression this asserts against is a silent one (blank screens, no error).
  it("waits for the parser instead of returning a blank screen", async () => {
    expect(await screenOf({ buffer: "content", cols: 20, rows: 3 })).toBe("content");
  });

  it("honours cursor addressing rather than replaying in write order", async () => {
    // Write "second" on row 2, then jump back to row 1 and write "first".
    const buffer = `${ESC}[2;1Hsecond${ESC}[1;1Hfirst`;
    expect(await screenOf({ buffer, cols: 20, rows: 4 })).toBe("first\nsecond");
  });

  it("applies an erase-screen so stale content does not survive", async () => {
    const buffer = `garbage${ESC}[2J${ESC}[1;1Hclean`;
    expect(await screenOf({ buffer, cols: 20, rows: 3 })).toBe("clean");
  });

  it("returns the CURRENT screen once output has scrolled past the viewport", async () => {
    const buffer = Array.from({ length: 12 }, (_, i) => `line${i}`).join("\r\n");
    // rows: 4 → only the last four lines are on screen.
    expect(await screenOf({ buffer, cols: 20, rows: 4 })).toBe("line8\nline9\nline10\nline11");
  });

  it("wraps at the configured width", async () => {
    expect(await screenOf({ buffer: "abcdef", cols: 3, rows: 4 })).toBe("abc\ndef");
  });

  it("handles an empty buffer", async () => {
    expect(await screenOf({ buffer: "", cols: 20, rows: 3 })).toBe("");
  });

  // A truncated tail can begin mid-sequence (#434 trims that, but a lone ESC at the very
  // end is still possible) — an unterminated sequence must not hang or throw.
  it("survives a buffer ending mid-sequence", async () => {
    expect(await screenOf({ buffer: `visible${ESC}[3`, cols: 20, rows: 3 })).toBe("visible");
  });

  // Dim is what tells an agent's ghost suggestion apart from text the user typed, so a
  // tmux-less host has to carry it out of the emulator too.
  it("reads the dim run off the cells", async () => {
    const rows = await renderScreen({ buffer: `❯ ${ESC}[2mwrite the tests${ESC}[0m`, cols: 40, rows: 2 });
    expect(rows[0]).toEqual({ text: "❯ write the tests", dim: "write the tests" });
  });

  it("leaves dim empty on a plain row", async () => {
    const rows = await renderScreen({ buffer: "❯ write the tests", cols: 40, rows: 2 });
    expect(rows[0]).toEqual({ text: "❯ write the tests", dim: "" });
  });
});
