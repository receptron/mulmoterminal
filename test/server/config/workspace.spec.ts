import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspace, workspaceFromQuery } from "../../../server/config/workspace.js";
import { CLAUDE_CWD } from "../../../server/config/env.js";

// resolveWorkspace guards what becomes a PTY's cwd, so every rejection matters: anything
// it lets through unchecked is a path the client chose.
describe("resolveWorkspace", () => {
  let dir = "";
  let file = "";

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-ws-"));
    file = path.join(dir, "a-file");
    await fs.writeFile(file, "");
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("accepts an absolute path to an existing directory", () => {
    expect(resolveWorkspace(dir)).toBe(dir);
  });

  it("falls back for a relative path, however real it is", () => {
    expect(resolveWorkspace("server")).toBe(CLAUDE_CWD);
    expect(resolveWorkspace("./server")).toBe(CLAUDE_CWD);
    expect(resolveWorkspace("../mulmoterminal")).toBe(CLAUDE_CWD);
  });

  it("falls back for a path that does not exist", () => {
    expect(resolveWorkspace(path.join(dir, "no-such-dir"))).toBe(CLAUDE_CWD);
  });

  it("falls back for a file — a cwd has to be a directory", () => {
    expect(resolveWorkspace(file)).toBe(CLAUDE_CWD);
  });

  it("falls back for null and for empty", () => {
    expect(resolveWorkspace(null)).toBe(CLAUDE_CWD);
    expect(resolveWorkspace("")).toBe(CLAUDE_CWD);
  });
});

describe("workspaceFromQuery", () => {
  it("resolves a string query", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mt-wsq-"));
    expect(workspaceFromQuery(dir)).toBe(dir);
    await fs.rm(dir, { recursive: true, force: true });
  });

  // Express hands over an array when a param repeats (?cwd=a&cwd=b) and undefined when it
  // is absent; neither may reach the validation as a path.
  it("falls back for anything that is not a string", () => {
    expect(workspaceFromQuery(undefined)).toBe(CLAUDE_CWD);
    expect(workspaceFromQuery(["/tmp", "/etc"])).toBe(CLAUDE_CWD);
    expect(workspaceFromQuery(42)).toBe(CLAUDE_CWD);
    expect(workspaceFromQuery(null)).toBe(CLAUDE_CWD);
  });
});
