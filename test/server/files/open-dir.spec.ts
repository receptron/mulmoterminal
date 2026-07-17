import { describe, it, expect } from "vitest";
import { openCommand } from "../../../server/files/open-dir";

describe("openCommand", () => {
  it("uses `open` on macOS", () => {
    expect(openCommand("darwin")).toBe("open");
  });
  it("uses `explorer` on Windows", () => {
    expect(openCommand("win32")).toBe("explorer");
  });
  it("falls back to `xdg-open` elsewhere (Linux)", () => {
    expect(openCommand("linux")).toBe("xdg-open");
  });
});
