import { describe, it, expect } from "vitest";
import { headerStyleFor } from "./cellHeaderStyle";

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
