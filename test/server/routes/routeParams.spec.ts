// @vitest-environment node
import { describe, it, expect } from "vitest";

import { parseIndexParam, normalizeAgent } from "../../../server/routes/routeParams.js";

describe("parseIndexParam", () => {
  it("parses a non-negative integer", () => {
    expect(parseIndexParam("0")).toBe(0);
    expect(parseIndexParam("5")).toBe(5);
    expect(parseIndexParam("12")).toBe(12);
  });

  it("is NaN for a missing param", () => {
    expect(parseIndexParam(null)).toBeNaN();
  });

  it("is NaN for anything that isn't a bare non-negative integer", () => {
    for (const raw of ["", "-1", "1.5", "1e2", "abc", " 3", "3 ", "+3", "0x1"]) {
      expect(parseIndexParam(raw)).toBeNaN();
    }
  });
});

describe("normalizeAgent", () => {
  it("selects codex only for an exact 'codex'", () => {
    expect(normalizeAgent("codex")).toBe("codex");
  });

  it("falls back to claude for everything else", () => {
    for (const raw of ["claude", "", "gpt", null, undefined, 5, ["codex"], { agent: "codex" }]) {
      expect(normalizeAgent(raw)).toBe("claude");
    }
  });

  // Case-sensitive on purpose: the value comes from a raw URL, and a mis-cased "CODEX"
  // starting Claude is safer than guessing.
  it("does not match a mis-cased CODEX", () => {
    expect(normalizeAgent("CODEX")).toBe("claude");
    expect(normalizeAgent("Codex")).toBe("claude");
  });
});
