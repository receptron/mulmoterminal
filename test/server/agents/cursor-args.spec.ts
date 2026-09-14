// @vitest-environment node
// The argv cursor is spawned with. Every case here pins something measured against cursor-agent
// 2026.09.10-fd3934a rather than something read off a docs page.
import { describe, it, expect } from "vitest";
import { buildCursorArgs } from "../../../server/agents/cursor-args.js";

const ID = "4078f9a6-4ce0-4906-a544-ca0cf917eb96";

describe("buildCursorArgs", () => {
  it("always resumes the id this server minted — there is no separate 'new session' form", () => {
    expect(buildCursorArgs({ sessionId: ID })).toEqual(["--resume", ID, "--force", "--trust"]);
  });

  it("passes --trust, because an unseen directory otherwise blocks on a modal nobody is watching", () => {
    expect(buildCursorArgs({ sessionId: ID })).toContain("--trust");
  });

  it("never passes -p: print mode runs the prompt and exits, and fires a different set of hooks", () => {
    const args = buildCursorArgs({ sessionId: ID, initialPrompt: "do the thing" });
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--print");
  });

  it("puts the seed LAST and positionally — anything after it would be read as more prompt words", () => {
    const args = buildCursorArgs({ sessionId: ID, model: "gpt-5.5-high", initialPrompt: "do the thing" });
    expect(args.at(-1)).toBe("do the thing");
    expect(args).toEqual(["--resume", ID, "--force", "--trust", "--model", "gpt-5.5-high", "do the thing"]);
  });

  it("omits --model entirely when none is configured, leaving cursor on its own default", () => {
    expect(buildCursorArgs({ sessionId: ID, model: null })).not.toContain("--model");
  });

  it("places no seed at all when there is none, rather than an empty positional", () => {
    expect(buildCursorArgs({ sessionId: ID, initialPrompt: null })).toEqual(["--resume", ID, "--force", "--trust"]);
  });
});
