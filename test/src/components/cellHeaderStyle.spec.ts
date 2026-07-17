import { describe, it, expect } from "vitest";
import { headerStyleFor, cellStyleFor, terminalHeaderStyleFor } from "../../../src/components/cellHeaderStyle";

describe("headerStyleFor", () => {
  it("maps a background + text color to the header CSS variables", () => {
    expect(headerStyleFor("#ff2e63", "#ffffff")).toEqual({
      "--cell-header-bg": "#ff2e63",
      "--cell-header-fg": "#ffffff",
    });
  });

  it("emits only the variable that is set", () => {
    expect(headerStyleFor("#123456", null)).toEqual({ "--cell-header-bg": "#123456" });
    expect(headerStyleFor(null, "#abcdef")).toEqual({ "--cell-header-fg": "#abcdef" });
  });

  it("returns an empty style when nothing is configured", () => {
    expect(headerStyleFor(null, undefined)).toEqual({});
  });

  it("drops non-hex values so garbage can't reach the inline style", () => {
    expect(headerStyleFor("red", "rgb(1,2,3)")).toEqual({});
    expect(headerStyleFor("#fff", "#12345")).toEqual({}); // wrong length
    expect(headerStyleFor("javascript:alert(1)", "#000000")).toEqual({ "--cell-header-fg": "#000000" });
  });
});

describe("cellStyleFor", () => {
  it("maps body / border / dot / button colors to the cell CSS variables", () => {
    expect(cellStyleFor("#101014", "#2a2a4e", "#00e676", "#c7cdf0")).toEqual({
      "--cell-bg": "#101014",
      "--cell-border": "#2a2a4e",
      "--cell-dot": "#00e676",
      "--cell-btn": "#c7cdf0",
    });
  });

  it("emits only the variables that are set", () => {
    expect(cellStyleFor(null, "#2a2a4e", null, null)).toEqual({ "--cell-border": "#2a2a4e" });
    expect(cellStyleFor("#101014", null, null, null)).toEqual({ "--cell-bg": "#101014" });
  });

  it("returns an empty style when nothing is configured", () => {
    expect(cellStyleFor(null, undefined, null, undefined)).toEqual({});
  });

  it("drops non-hex values", () => {
    expect(cellStyleFor("blue", "#12", "rgb(0,0,0)", "#abcdef")).toEqual({ "--cell-btn": "#abcdef" });
  });
});

describe("terminalHeaderStyleFor", () => {
  it("reuses the header bg/fg vars and adds the button var", () => {
    expect(terminalHeaderStyleFor("#241640", "#ffd166", "#4dd0e1")).toEqual({
      "--cell-header-bg": "#241640",
      "--cell-header-fg": "#ffd166",
      "--cell-btn": "#4dd0e1",
    });
  });

  it("emits only the set + valid vars", () => {
    expect(terminalHeaderStyleFor("#241640", null, "nope")).toEqual({ "--cell-header-bg": "#241640" });
    expect(terminalHeaderStyleFor(null, null, null)).toEqual({});
  });
});
