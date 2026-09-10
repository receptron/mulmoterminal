// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostStateRoot } from "../../../server/infra/host-state-root.js";
import { workspaceKey } from "../../../server/infra/workspace-key.js";

// The gate reads MULMOCLAUDE_WORKSPACE_PATH through `isManagedWorkspace`, and resolves real
// paths — so the directories have to exist for the managed case to be answered truthfully.
describe("hostStateRoot", () => {
  let tmp = "";
  const saved = process.env.MULMOCLAUDE_WORKSPACE_PATH;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "host-state-root-"));
    await fs.mkdir(path.join(tmp, "managed"), { recursive: true });
    await fs.mkdir(path.join(tmp, "project"), { recursive: true });
    process.env.MULMOCLAUDE_WORKSPACE_PATH = path.join(tmp, "managed");
  });

  afterEach(async () => {
    if (saved === undefined) delete process.env.MULMOCLAUDE_WORKSPACE_PATH;
    else process.env.MULMOCLAUDE_WORKSPACE_PATH = saved;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // Both hosts read each other's scheduler state and notifier files there; moving ours out
  // would split those pairs.
  it("leaves the managed workspace's state in the workspace", () => {
    const managed = path.join(tmp, "managed");
    expect(hostStateRoot(managed, "/home")).toBe(managed);
  });

  // `path.join` would collapse these itself, so the spelling is built by concatenation — the
  // resolver in `isManagedWorkspace` is the thing under test, not path.join.
  it("recognises the managed workspace through a different spelling of the same path", () => {
    const managed = path.join(tmp, "managed");
    [`${managed}${path.sep}`, `${managed}${path.sep}.`, `${managed}${path.sep}sub${path.sep}..`].forEach((spelling) => {
      expect(hostStateRoot(spelling, "/home")).toBe(spelling);
    });
  });

  // The whole point: a launch directory is usually someone's project (#2024).
  it("keeps state out of a workspace that is not the managed one", () => {
    const project = path.join(tmp, "project");
    const root = hostStateRoot(project, "/home");
    expect(root).toBe(path.join("/home", "workspaces", workspaceKey(project)));
    expect(root.startsWith(project)).toBe(false);
  });

  it("gives two unmanaged workspaces their own roots", () => {
    expect(hostStateRoot(path.join(tmp, "project"), "/home")).not.toEqual(hostStateRoot(path.join(tmp, "other"), "/home"));
  });

  // The layout under the redirected root mirrors the workspace's, which is what lets core and
  // the notifier engine keep joining the same relative paths unchanged.
  it("keeps the relative layout, so callers join the same paths either way", () => {
    const root = hostStateRoot(path.join(tmp, "project"), "/home");
    expect(path.join(root, "config", "scheduler", "state.json")).toMatch(/config[/\\]scheduler[/\\]state\.json$/);
    expect(path.join(root, "data", "notifier")).toMatch(/data[/\\]notifier$/);
  });

  it("defaults the home to ~/.mulmoterminal", () => {
    const root = hostStateRoot(path.join(tmp, "project"));
    expect(root.startsWith(path.join(os.homedir(), ".mulmoterminal"))).toBe(true);
  });
});
