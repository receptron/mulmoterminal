// @vitest-environment node
// The three-tier answer to "where is this session working": the live PTY wins over the
// persisted note (a cell relaunched elsewhere keeps its id but not its directory), and
// the workspace is what a caller that names no session gets.
import { describe, it, expect } from "vitest";
import { pickSessionCwd } from "../../../server/session/session-cwd.js";

const WORKSPACE = "/home/u/mulmoclaude";

describe("pickSessionCwd", () => {
  it("prefers the live PTY's directory over the remembered one", () => {
    expect(pickSessionCwd({ livePtyCwd: "/repos/a", rememberedCwd: "/repos/b", workspace: WORKSPACE })).toBe("/repos/a");
  });

  it("falls back to the remembered directory when no PTY is live", () => {
    expect(pickSessionCwd({ livePtyCwd: null, rememberedCwd: "/repos/b", workspace: WORKSPACE })).toBe("/repos/b");
  });

  it("falls back to the workspace when neither is known", () => {
    expect(pickSessionCwd({ workspace: WORKSPACE })).toBe(WORKSPACE);
    expect(pickSessionCwd({ livePtyCwd: null, rememberedCwd: null, workspace: WORKSPACE })).toBe(WORKSPACE);
  });

  it("treats an empty string as not known — `ptys` entries default to one", () => {
    expect(pickSessionCwd({ livePtyCwd: "", rememberedCwd: "/repos/b", workspace: WORKSPACE })).toBe("/repos/b");
    expect(pickSessionCwd({ livePtyCwd: "", rememberedCwd: "", workspace: WORKSPACE })).toBe(WORKSPACE);
  });
});
