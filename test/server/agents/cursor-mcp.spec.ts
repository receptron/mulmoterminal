// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { cursorMcpConfigFile, mergeCursorMcpServers, syncCursorMcpConfig } from "../../../server/agents/cursor-mcp.js";

describe("mergeCursorMcpServers", () => {
  it("writes one entry per group", () => {
    const merged = mergeCursorMcpServers({}, ["render", "media"], 34567);
    expect(Object.keys(merged)).toEqual(["mulmoterminal-render", "mulmoterminal-media"]);
  });

  // ARGV, not an `env` block, and this is the assertion that would have caught the end-to-end
  // failure: cursor starts an MCP server on a curated environment, so an entry that only names the
  // group in `env` reaches the bridge without a port and the bridge refuses to serve anything.
  it("puts the group and the port on the command line, as muse's manifest does", () => {
    const entry = mergeCursorMcpServers({}, ["render"], 34567)["mulmoterminal-render"];
    expect(entry).toMatchObject({ args: expect.arrayContaining(["--group", "render", "--port", "34567"]) });
    expect(JSON.stringify(entry)).not.toContain("MULMOTERMINAL_TOOL_GROUP");
  });

  // The session is what must NOT be in the file: `.cursor/mcp.json` is shared by every cursor
  // session in the directory and outlives all of them. The bridge asks /api/mcp-resolve instead.
  it("never writes a session id", () => {
    expect(JSON.stringify(mergeCursorMcpServers({}, ["render"], 34567))).not.toContain("SESSION");
  });

  it("leaves servers we do not own alone", () => {
    const merged = mergeCursorMcpServers({ "someone-elses": { command: "x" } }, ["render"], 34567);
    expect(merged["someone-elses"]).toEqual({ command: "x" });
  });

  it("drops the entry for a group that was switched off", () => {
    const merged = mergeCursorMcpServers({ "mulmoterminal-render": { command: "old" }, "mulmoterminal-media": { command: "old" } }, ["media"], 34567);
    expect(Object.keys(merged)).toEqual(["mulmoterminal-media"]);
  });

  // An OWN `__proto__` key only exists when the object came from JSON.parse — an object literal
  // sets the prototype instead — so the input here must be parsed, not written out.
  it("keeps a user's own `__proto__` server entry instead of dropping it", () => {
    const existing: Record<string, unknown> = JSON.parse('{"__proto__":{"command":"theirs"},"keep":{"command":"x"}}');
    const merged = mergeCursorMcpServers(existing, ["render"], 34567);
    expect(Object.prototype.hasOwnProperty.call(merged, "__proto__")).toBe(true);
    expect(JSON.stringify(merged)).toContain("theirs");
  });

  // `mt` is the all-tools id the claude/codex spawn config carries; no file path has ever written
  // it, so one in a user's `.cursor/mcp.json` is theirs (Codex review on #1355, via agy).
  it("leaves a user's own `mt` entry alone", () => {
    expect(mergeCursorMcpServers({ mt: { command: "theirs" } }, ["render"], 34567)["mt"]).toEqual({ command: "theirs" });
  });
});

describe("syncCursorMcpConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-mcp-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (): Record<string, unknown> => JSON.parse(fs.readFileSync(cursorMcpConfigFile(dir), "utf8")).mcpServers;

  it("writes .cursor/mcp.json for the registered groups", () => {
    syncCursorMcpConfig(dir, ["render"]);
    expect(Object.keys(read())).toEqual(["mulmoterminal-render"]);
  });

  // The ids are what then has to be APPROVED — an entry written and not approved is invisible to
  // the agent rather than prompted for, so the caller needs them back rather than a void.
  it("answers the ids it registered, so they can be approved", () => {
    expect(syncCursorMcpConfig(dir, ["render", "data"])).toEqual(["mulmoterminal-render", "mulmoterminal-data"]);
  });

  it("answers nothing when there was nothing to register", () => {
    expect(syncCursorMcpConfig(dir, [])).toEqual([]);
  });

  it("removes the file once nothing is left in it", () => {
    syncCursorMcpConfig(dir, ["render"]);
    syncCursorMcpConfig(dir, []);
    expect(fs.existsSync(cursorMcpConfigFile(dir))).toBe(false);
  });

  it("keeps the file when the user has servers of their own in it", () => {
    fs.mkdirSync(path.dirname(cursorMcpConfigFile(dir)), { recursive: true });
    fs.writeFileSync(cursorMcpConfigFile(dir), JSON.stringify({ mcpServers: { theirs: { command: "x" } } }));
    syncCursorMcpConfig(dir, []);
    expect(read()).toEqual({ theirs: { command: "x" } });
  });

  // Grok's rule, not agy's: `.cursor/mcp.json` is a project config a team may have committed on
  // purpose, and excluding a tracked file someone else wrote would hide their edits from them.
  it("excludes the file from git only when it did not exist before", () => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    syncCursorMcpConfig(dir, ["render"]);
    expect(fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).toContain(".cursor/mcp.json");
  });

  it("leaves a pre-existing file out of .git/info/exclude", () => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    fs.mkdirSync(path.dirname(cursorMcpConfigFile(dir)), { recursive: true });
    fs.writeFileSync(cursorMcpConfigFile(dir), JSON.stringify({ mcpServers: { theirs: { command: "x" } } }));
    syncCursorMcpConfig(dir, ["render"]);
    expect(fs.existsSync(path.join(dir, ".git", "info", "exclude"))).toBe(false);
    expect(read()["theirs"]).toEqual({ command: "x" });
  });

  // Not JSON means it is not a file we wrote, and rewriting it would lose whatever it is.
  it("leaves an unparseable file untouched", () => {
    const file = cursorMcpConfigFile(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "not json");
    expect(syncCursorMcpConfig(dir, ["render"])).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe("not json");
  });

  // A checkout can commit `.cursor` or the file itself as a symlink, and every write below follows
  // links (symlink-guard.ts).
  it.skipIf(process.platform === "win32")("refuses to write through a symlinked mcp.json", () => {
    const target = path.join(dir, "their-own.json");
    fs.writeFileSync(target, "{}");
    fs.mkdirSync(path.dirname(cursorMcpConfigFile(dir)), { recursive: true });
    fs.symlinkSync(target, cursorMcpConfigFile(dir));
    expect(syncCursorMcpConfig(dir, ["render"])).toEqual([]);
    expect(fs.readFileSync(target, "utf8")).toBe("{}");
  });

  // A key like `constructor` in the user's file must not resolve through Object.prototype.
  it("does not read mcpServers through the prototype chain", () => {
    const file = cursorMcpConfigFile(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ __proto__: { mcpServers: { injected: { command: "x" } } } }));
    syncCursorMcpConfig(dir, ["render"]);
    expect(Object.keys(read())).toEqual(["mulmoterminal-render"]);
  });
});
