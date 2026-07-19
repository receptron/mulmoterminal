import { describe, it, expect } from "vitest";
import { appendBoundedOutput, stripTerminalQueries } from "../../../server/session/terminal-replay.js";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe("stripTerminalQueries", () => {
  it("removes a Device Attributes query embedded in output (the 0;276;0c symptom source)", () => {
    expect(stripTerminalQueries(`abc${ESC}[>c def`)).toBe("abc def");
    expect(stripTerminalQueries(`${ESC}[c`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>0c`)).toBe("");
  });

  it("removes device/cursor status queries", () => {
    expect(stripTerminalQueries(`${ESC}[6n`)).toBe("");
    expect(stripTerminalQueries(`x${ESC}[5ny`)).toBe("xy");
    expect(stripTerminalQueries(`${ESC}[?6n`)).toBe("");
  });

  it("removes kitty-keyboard and XTVERSION queries", () => {
    expect(stripTerminalQueries(`${ESC}[?u`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>q`)).toBe("");
    expect(stripTerminalQueries(`${ESC}[>0q`)).toBe("");
  });

  it("removes OSC color queries (BEL- or ST-terminated)", () => {
    expect(stripTerminalQueries(`${ESC}]10;?${BEL}`)).toBe("");
    expect(stripTerminalQueries(`${ESC}]11;?${ESC}\\`)).toBe("");
  });

  it("does NOT strip a DA RESPONSE (multi-param) — only queries", () => {
    const response = `${ESC}[>0;276;0c`;
    expect(stripTerminalQueries(response)).toBe(response);
  });

  it("leaves visible text and SGR colour sequences untouched", () => {
    const styled = `${ESC}[31mhello${ESC}[0m world`;
    expect(stripTerminalQueries(styled)).toBe(styled);
    expect(stripTerminalQueries("plain text")).toBe("plain text");
  });
});

describe("appendBoundedOutput", () => {
  it("appends verbatim while under the limit", () => {
    expect(appendBoundedOutput("abc", "def", 100)).toBe("abcdef");
    expect(appendBoundedOutput("", "", 100)).toBe("");
  });

  it("keeps the tail once the limit is exceeded", () => {
    // Exactly at the limit is still verbatim — only a genuine overflow trims.
    expect(appendBoundedOutput("abcde", "", 5)).toBe("abcde");
    expect(appendBoundedOutput("abc\ndef", "ghi", 6)).toBe("defghi");
  });

  // The #434 regression: a cut inside an SGR left "5;196m" rendering as literal text.
  // Worst case — the tail has no newline and no later ESC to resume from.
  it("drops a leading sequence remnant when there is no boundary to resume from", () => {
    const stream = "x".repeat(50) + `${ESC}[38;5;196m` + "RED";
    expect(appendBoundedOutput(stream, "", 9)).toBe("RED"); // was "5;196mRED"
  });

  it("keeps text that merely resembles a remnant", () => {
    expect(appendBoundedOutput("zzzhello world", "", 11)).toBe("hello world");
  });

  it("prefers a newline boundary when it comes before the next sequence", () => {
    const stream = `aaa\nbbb${ESC}[0m`;
    expect(appendBoundedOutput(stream, "", 8)).toBe(`bbb${ESC}[0m`);
  });

  it("resumes at the sequence start when no newline precedes it", () => {
    const stream = `aaaa${ESC}[31mbbb`;
    expect(appendBoundedOutput(stream, "", 9)).toBe(`${ESC}[31mbbb`);
  });

  // A full-screen TUI redraws with cursor moves, not newlines, so the escape branch
  // carries these; plain shell output is carried by the newline branch.
  it("returns the raw tail when the window holds no boundary at all", () => {
    const stream = "y".repeat(200);
    expect(appendBoundedOutput(stream, "", 10)).toBe("y".repeat(10));
  });

  it("stays within the limit", () => {
    const stream = `${"z".repeat(500)}\n${"w".repeat(500)}`;
    expect(appendBoundedOutput(stream, "more", 64).length).toBeLessThanOrEqual(64);
  });
});
