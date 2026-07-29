import { describe, it, expect } from "vitest";
import { buildAntigravityArgs } from "../../../server/agents/antigravity-args.js";

const base = { resume: null };

describe("buildAntigravityArgs", () => {
  it("passes no arguments for a fresh default session", () => {
    expect(buildAntigravityArgs({ ...base })).toEqual([]);
  });

  it("adds model override when provided", () => {
    expect(buildAntigravityArgs({ ...base, model: "gemini-2.5-pro" })).toEqual(["--model", "gemini-2.5-pro"]);
  });

  it("adds --dangerously-skip-permissions when skipPermissions is true", () => {
    expect(buildAntigravityArgs({ ...base, skipPermissions: true })).toEqual(["--dangerously-skip-permissions"]);
  });

  it("runs a seed as the first turn with --prompt-interactive", () => {
    expect(buildAntigravityArgs({ ...base, initialPrompt: "do the thing" })).toEqual(["--prompt-interactive", "do the thing"]);
  });

  // It takes a value, so a flag after it would be read as part of the prompt.
  it("puts the seed last", () => {
    const args = buildAntigravityArgs({ resume: "a4dbbf1e-9cba-4879-a84a-d397b47e4f47", skipPermissions: true, initialPrompt: "go" });
    expect(args[args.length - 2]).toBe("--prompt-interactive");
    expect(args[args.length - 1]).toBe("go");
  });

  it("adds --conversation <id> when resume ID is provided", () => {
    expect(buildAntigravityArgs({ resume: "a4dbbf1e-9cba-4879-a84a-d397b47e4f47" })).toEqual(["--conversation", "a4dbbf1e-9cba-4879-a84a-d397b47e4f47"]);
  });

  it("combines all options in expected flag order", () => {
    expect(
      buildAntigravityArgs({
        resume: "a4dbbf1e-9cba-4879-a84a-d397b47e4f47",
        model: "gemini-2.5-flash",
        skipPermissions: true,
      }),
    ).toEqual(["--model", "gemini-2.5-flash", "--dangerously-skip-permissions", "--conversation", "a4dbbf1e-9cba-4879-a84a-d397b47e4f47"]);
  });
});
