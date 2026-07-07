import { describe, it, expect } from "vitest";
import { buildCodexArgs } from "./codex-args.js";

describe("buildCodexArgs", () => {
  it("passes no id for a fresh session (codex mints its own)", () => {
    expect(buildCodexArgs({ resume: null, model: null })).toEqual([]);
  });

  it("adds the model override before the subcommand", () => {
    expect(buildCodexArgs({ resume: null, model: "gpt-5.4" })).toEqual(["--model", "gpt-5.4"]);
  });

  it("resumes a known rollout id via the resume subcommand", () => {
    expect(buildCodexArgs({ resume: "019f251d-001c-7542-b13e-9a627effce52", model: null })).toEqual(["resume", "019f251d-001c-7542-b13e-9a627effce52"]);
  });

  it("keeps global flags ahead of the resume subcommand", () => {
    expect(buildCodexArgs({ resume: "abc", model: "gpt-5.4" })).toEqual(["--model", "gpt-5.4", "resume", "abc"]);
  });
});
