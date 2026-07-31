// @vitest-environment node
// Which directory counts as THE workspace. The whole of PR2 hangs off this one predicate: answer
// it wrongly in the false direction and the workspace cell silently behaves like an ordinary one
// (no GUI MCP, no Canvas, and nothing anywhere says why); wrongly in the true direction and an
// ordinary project cell quietly changes behaviour, which is the one thing this change must not do.
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// CLAUDE_CWD is read from the environment at import time, so it is set BEFORE the import — the
// same reason the mcp-announce spec points HOME somewhere disposable first.
const ROOT = mkdtempSync(path.join(os.tmpdir(), "mt-workspace-"));
const WORKSPACE = path.join(ROOT, "workspace");
const REAL_CLAUDE_CWD = process.env.CLAUDE_CWD;
mkdirSync(WORKSPACE, { recursive: true });
process.env.CLAUDE_CWD = WORKSPACE;

const { isWorkspaceCwd } = await import("../../../server/config/env.js");

afterAll(() => {
  if (REAL_CLAUDE_CWD === undefined) delete process.env.CLAUDE_CWD;
  else process.env.CLAUDE_CWD = REAL_CLAUDE_CWD;
  rmSync(ROOT, { recursive: true, force: true });
});

describe("isWorkspaceCwd", () => {
  it("says yes to the workspace itself", () => {
    expect(isWorkspaceCwd(WORKSPACE)).toBe(true);
  });

  it("says yes when no cwd was given at all", () => {
    // The launch form's blank field means "the server's default", and spawnClaudePty defaults
    // `cwd = CLAUDE_CWD` — so a cell that never named a directory IS in the workspace. Answering
    // no here is the most likely way for the feature to look broken for the plainest case.
    expect(isWorkspaceCwd(undefined)).toBe(true);
    expect(isWorkspaceCwd("")).toBe(true);
  });

  it("says no to a project directory", () => {
    const project = path.join(ROOT, "project");
    mkdirSync(project, { recursive: true });
    expect(isWorkspaceCwd(project)).toBe(false);
  });

  it("says NO to a subdirectory of the workspace — equality, not prefix", () => {
    const inside = path.join(WORKSPACE, "foo");
    mkdirSync(inside, { recursive: true });
    expect(isWorkspaceCwd(inside)).toBe(false);
  });

  it("ignores a trailing slash and a `..` hop", () => {
    // The cwd arrives from a `?cwd=` query built out of a user preset, so neither is exotic.
    expect(isWorkspaceCwd(`${WORKSPACE}/`)).toBe(true);
    expect(isWorkspaceCwd(path.join(WORKSPACE, "foo", ".."))).toBe(true);
  });

  it("follows a SYMLINK to the workspace", () => {
    // The case that actually breaks on a dev machine: `~/mulmoclaude` is commonly a symlink, and a
    // preset pointing at the link would compare unequal to the resolved CLAUDE_CWD.
    const link = path.join(ROOT, "link-to-workspace");
    symlinkSync(WORKSPACE, link);
    expect(isWorkspaceCwd(link)).toBe(true);
  });

  it("falls back to a normalised compare for a path that does not exist", () => {
    // realpath throws on a missing directory. A cell whose directory is gone fails to spawn and is
    // reported as that — this predicate must not be where the error surfaces, nor throw inside the
    // spawn path and take the session with it.
    expect(() => isWorkspaceCwd(path.join(ROOT, "gone"))).not.toThrow();
    expect(isWorkspaceCwd(path.join(ROOT, "gone"))).toBe(false);
    expect(isWorkspaceCwd(`${WORKSPACE}/../workspace`)).toBe(true);
  });
});

describe("isWorkspaceCwd — a workspace that is itself a symlink", () => {
  // The mirror of the case above, and the one a string compare passes by luck: CLAUDE_CWD names
  // the LINK while the cell names the real directory.
  let linkedRoot: string;
  let target: string;
  beforeAll(() => {
    linkedRoot = mkdtempSync(path.join(os.tmpdir(), "mt-workspace-link-"));
    target = path.join(linkedRoot, "real");
    mkdirSync(target, { recursive: true });
  });
  afterAll(() => rmSync(linkedRoot, { recursive: true, force: true }));

  it("resolves both sides before comparing", async () => {
    const link = path.join(linkedRoot, "link");
    symlinkSync(target, link);
    process.env.CLAUDE_CWD = link;
    // The module reads CLAUDE_CWD once, at import — so the registry has to be dropped for the new
    // value to be seen. A plain re-import would hand back the cached module and the assertion
    // would pass against the OLD workspace, proving nothing.
    vi.resetModules();
    const mod = await import("../../../server/config/env.js");
    expect(mod.isWorkspaceCwd(target)).toBe(true);
    process.env.CLAUDE_CWD = WORKSPACE;
  });
});
