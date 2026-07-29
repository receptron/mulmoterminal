// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { antigravityMcpConfigFile, mergeAntigravityMcpServers, syncAntigravityMcpConfig } from "../../../server/agents/antigravity-mcp.js";

describe("mergeAntigravityMcpServers", () => {
  it("writes one entry per group, carrying the group in its env", () => {
    const merged = mergeAntigravityMcpServers({}, ["render", "media"]);
    expect(Object.keys(merged)).toEqual(["mulmoterminal-render", "mulmoterminal-media"]);
    expect(merged["mulmoterminal-render"]).toMatchObject({ env: { MULMOTERMINAL_TOOL_GROUP: "render" } });
  });

  // The session is what must NOT be in the file: it is shared by every session in the directory.
  it("never writes a session id", () => {
    expect(JSON.stringify(mergeAntigravityMcpServers({}, ["render"]))).not.toContain("SESSION");
  });

  it("leaves servers we do not own alone", () => {
    const merged = mergeAntigravityMcpServers({ "someone-elses": { command: "x" } }, ["render"]);
    expect(merged["someone-elses"]).toEqual({ command: "x" });
  });

  it("drops the entry for a group that was switched off", () => {
    const merged = mergeAntigravityMcpServers({ "mulmoterminal-render": { command: "old" }, "mulmoterminal-media": { command: "old" } }, ["media"]);
    expect(Object.keys(merged)).toEqual(["mulmoterminal-media"]);
  });

  // The all-tools id an earlier version wrote. Cleaning it up here is what stops it outliving
  // the code that made it.
  it("drops the legacy all-tools entry", () => {
    expect(mergeAntigravityMcpServers({ "mulmoterminal-gui": { command: "old" } }, [])).toEqual({});
  });
});

describe("syncAntigravityMcpConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-mcp-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (): Record<string, unknown> => JSON.parse(fs.readFileSync(antigravityMcpConfigFile(dir), "utf8")).mcpServers;

  it("writes .agents/mcp_config.json for the registered groups", () => {
    syncAntigravityMcpConfig(dir, ["render"]);
    expect(Object.keys(read())).toEqual(["mulmoterminal-render"]);
  });

  it("removes the file once nothing is left in it", () => {
    syncAntigravityMcpConfig(dir, ["render"]);
    syncAntigravityMcpConfig(dir, []);
    expect(fs.existsSync(antigravityMcpConfigFile(dir))).toBe(false);
  });

  it("keeps the file when the user has servers of their own in it", () => {
    fs.mkdirSync(path.dirname(antigravityMcpConfigFile(dir)), { recursive: true });
    fs.writeFileSync(antigravityMcpConfigFile(dir), JSON.stringify({ mcpServers: { theirs: { command: "x" } } }));
    syncAntigravityMcpConfig(dir, []);
    expect(read()).toEqual({ theirs: { command: "x" } });
  });

  // The user's own repo: the file is a local switch, so it must not turn up in their git status.
  it("excludes the file through .git/info/exclude, not their .gitignore", () => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    syncAntigravityMcpConfig(dir, ["render"]);
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).toContain(".agents/mcp_config.json");
    expect(fs.existsSync(path.join(dir, ".gitignore"))).toBe(false);
  });

  it("does not add the exclude line twice", () => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), "# theirs\nbuild/");
    syncAntigravityMcpConfig(dir, ["render"]);
    syncAntigravityMcpConfig(dir, ["render", "media"]);
    const lines = fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8").split("\n");
    expect(lines.filter((line) => line === ".agents/mcp_config.json")).toHaveLength(1);
    expect(lines[0]).toBe("# theirs"); // theirs kept, and a missing trailing newline not eaten
    expect(lines).toContain("build/");
  });

  // A worktree or submodule keeps `.git` as a file, and a session can run below the repo root.
  it("writes the config anyway when there is no .git/info to write to", () => {
    syncAntigravityMcpConfig(dir, ["render"]);
    expect(Object.keys(read())).toEqual(["mulmoterminal-render"]);
  });

  // Not JSON means it is not a file we wrote, and rewriting it would lose whatever it is.
  it("leaves an unparseable file untouched", () => {
    const file = antigravityMcpConfigFile(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    syncAntigravityMcpConfig(dir, ["render"]);
    expect(fs.readFileSync(file, "utf8")).toBe("not json");
  });
});
