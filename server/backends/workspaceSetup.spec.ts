// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { initWorkspaceSetup, isManagedWorkspace } from "./workspaceSetup.js";

const ORIG = process.env.MULMOCLAUDE_WORKSPACE_PATH;
afterEach(() => {
  if (ORIG === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
  else process.env.MULMOCLAUDE_WORKSPACE_PATH = ORIG;
});

describe("workspace setup gating + seeding", () => {
  it("treats ~/mulmoclaude + MULMOCLAUDE_WORKSPACE_PATH as managed, arbitrary dirs not", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-managed-"));
    try {
      delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
      expect(isManagedWorkspace(dir)).toBe(false);
      expect(isManagedWorkspace(path.join(homedir(), "mulmoclaude"))).toBe(true);
      process.env.MULMOCLAUDE_WORKSPACE_PATH = dir;
      expect(isManagedWorkspace(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seeds helps + presets into a managed workspace", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-seed-"));
    process.env.MULMOCLAUDE_WORKSPACE_PATH = dir;
    try {
      initWorkspaceSetup({ workspace: dir });
      expect(existsSync(path.join(dir, "config", "helps", "index.md"))).toBe(true);
      expect(readdirSync(path.join(dir, "data", "skills", "catalog", "preset")).some((slug) => slug.startsWith("mc-"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT write into a non-managed workspace (e.g. an arbitrary launcher cwd)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-skip-"));
    try {
      delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
      initWorkspaceSetup({ workspace: dir });
      expect(existsSync(path.join(dir, "config"))).toBe(false);
      expect(existsSync(path.join(dir, "data"))).toBe(false);
      expect(existsSync(path.join(dir, ".claude"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
