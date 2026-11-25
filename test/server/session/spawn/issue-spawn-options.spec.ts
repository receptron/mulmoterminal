// @vitest-environment node
// #1253. The invariant worth a test of its own is that EXACTLY ONE of draft / initialPrompt is
// set: planDraftInjection resolves `draft ?? initialPrompt`, so a spawn carrying both types the
// text and never submits — with no error anywhere, which reads as "the run option does nothing".
import { describe, it, expect } from "vitest";

import { issueSpawnOptions } from "../../../../server/session/spawn/issue-spawn-options.js";
import { planDraftInjection } from "../../../../server/session/spawn/draft-plan.js";

const SEED = "GitHub issue #1253: run it";
const identity = (s: string) => s;

describe("issueSpawnOptions", () => {
  it("leaves the seed for review when run is false", () => {
    expect(issueSpawnOptions("/wt/1253", SEED, false)).toEqual({ cwd: "/wt/1253", attachGuiMcp: false, draft: SEED });
  });

  it("hands the seed over as the first turn when run is true", () => {
    expect(issueSpawnOptions("/wt/1253", SEED, true)).toEqual({ cwd: "/wt/1253", attachGuiMcp: false, initialPrompt: SEED });
  });

  it.each([true, false])("sets exactly one of draft / initialPrompt (run=%s)", (run) => {
    const options = issueSpawnOptions("/wt/1253", SEED, run);
    expect([options.draft, options.initialPrompt].filter((value) => value !== undefined)).toEqual([SEED]);
  });

  // Both directions against the rule they exist to drive, rather than against the keys alone: the
  // keys are only right because planDraftInjection reads them this way.
  it.each([
    [true, true],
    [false, false],
  ])("run=%s reaches the injector as autoSubmit=%s", (run, autoSubmit) => {
    const { initialPrompt, draft } = issueSpawnOptions("/wt/1253", SEED, run);
    expect(planDraftInjection(initialPrompt, draft, identity)).toEqual({ text: SEED, autoSubmit });
  });

  // A worktree session is a working session in a repository, the same shape as a grid dev
  // terminal, so the project's own MCP servers load — running the seed does not change that.
  it("does not attach the GUI MCP unless asked for every tool", () => {
    expect(issueSpawnOptions("/wt/1253", SEED, true).attachGuiMcp).toBe(false);
    expect(issueSpawnOptions("/wt/1253", SEED, false).attachGuiMcp).toBe(false);
  });

  // #3413: an implementer a session started runs the review loop, whose tools only the all-tools url has.
  it("attaches the GUI MCP when every tool is asked for", () => {
    expect(issueSpawnOptions("/wt/1253", SEED, true, { allTools: true })).toEqual({ cwd: "/wt/1253", attachGuiMcp: true, initialPrompt: SEED });
    expect(issueSpawnOptions("/wt/1253", SEED, true, { allowedTools: ["Write(//e/**)"] })).toEqual({
      cwd: "/wt/1253",
      attachGuiMcp: false,
      initialPrompt: SEED,
      extraAllowedTools: ["Write(//e/**)"],
    });
    expect(issueSpawnOptions("/wt/1253", SEED, true, { allowedTools: [] })).not.toHaveProperty("extraAllowedTools");
  });
});
