// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { isManagedWorkspace, initWorkspaceSetup } from "../../../server/backends/../../server/backends/workspaceSetup.js";

// Save/restore MULMOCLAUDE_WORKSPACE_PATH so a test can mark a temp dir as the
// managed workspace without leaking into sibling tests.
const ENV_KEY = "MULMOCLAUDE_WORKSPACE_PATH";
let savedEnv: string | undefined;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ws-setup-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  Reflect.deleteProperty(process.env, ENV_KEY);
});

afterEach(() => {
  if (savedEnv === undefined) Reflect.deleteProperty(process.env, ENV_KEY);
  else process.env[ENV_KEY] = savedEnv;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("isManagedWorkspace", () => {
  it("treats ~/mulmoclaude as managed by default", () => {
    expect(isManagedWorkspace(path.join(homedir(), "mulmoclaude"))).toBe(true);
  });

  it("treats an arbitrary project dir as not managed", () => {
    expect(isManagedWorkspace(makeTempDir())).toBe(false);
  });

  it("honors MULMOCLAUDE_WORKSPACE_PATH (resolved compare)", () => {
    const dir = makeTempDir();
    process.env[ENV_KEY] = dir;
    expect(isManagedWorkspace(dir)).toBe(true);
    // A trailing-segment variant resolves to the same path.
    expect(isManagedWorkspace(path.join(dir, "sub", ".."))).toBe(true);
    expect(isManagedWorkspace(makeTempDir())).toBe(false);
  });
});

describe("initWorkspaceSetup", () => {
  it("seeds helps + preset-skills catalog into a managed workspace", () => {
    const workspace = makeTempDir();
    process.env[ENV_KEY] = workspace;

    initWorkspaceSetup({ workspace });

    // Help docs land under config/helps.
    expect(existsSync(path.join(workspace, "config", "helps", "index.md"))).toBe(true);
    // Preset skills land in the catalog half (UI-visible, not Claude-visible).
    const presetDir = path.join(workspace, "data", "skills", "catalog", "preset");
    expect(existsSync(path.join(presetDir, "mc-library", "SKILL.md"))).toBe(true);
    expect(readdirSync(presetDir).every((slug) => slug.startsWith("mc-"))).toBe(true);
  });

  it("writes nothing into a non-managed workspace", () => {
    const workspace = makeTempDir();
    // No MULMOCLAUDE_WORKSPACE_PATH → an arbitrary dir is not managed.

    initWorkspaceSetup({ workspace });

    expect(existsSync(path.join(workspace, "config"))).toBe(false);
    expect(existsSync(path.join(workspace, "data"))).toBe(false);
    expect(existsSync(path.join(workspace, ".claude"))).toBe(false);
    expect(readdirSync(workspace)).toHaveLength(0);
  });
});
