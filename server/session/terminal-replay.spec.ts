import { describe, it, expect } from "vitest";
import { stripTerminalQueries } from "./terminal-replay.js";

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
