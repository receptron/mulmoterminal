// @vitest-environment node
// Laying Claude Code's settings over each other for a directory (#3332): lists add up, other keys go to
// the strongest file, every value naming where it came from.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { layerSettings, managedSettingsFile, settingsFiles } from "../../../../server/backends/library/settings-layers";
import { readSettings } from "../../../../server/backends/library/settings-layers-read";

describe("settingsFiles", () => {
  it("lists the user's, the project's, the local and the managed file, weakest first", () => {
    expect(settingsFiles("/w/app", "/h/.claude", "linux")).toEqual([
      { source: "user", path: "/h/.claude/settings.json" },
      { source: "project", path: "/w/app/.claude/settings.json" },
      { source: "local", path: "/w/app/.claude/settings.local.json" },
      { source: "managed", path: "/etc/claude-code/managed-settings.json" },
    ]);
    expect([managedSettingsFile("darwin"), managedSettingsFile("win32")]).toEqual([
      "/Library/Application Support/ClaudeCode/managed-settings.json",
      "C:\\Program Files\\ClaudeCode\\managed-settings.json",
    ]);
  });
});

describe("layerSettings", () => {
  const layered = layerSettings("/w/app", [
    { source: "user", json: { model: "opus", permissions: { allow: ["Bash(npm test)"], deny: ["Read(.env)"] }, env: { A: "user", B: "user" } } },
    {
      source: "project",
      json: {
        model: "sonnet",
        permissions: { allow: ["Bash(yarn lint)", 7] },
        env: { A: "project" },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
      },
    },
    {
      source: "local",
      json: {
        permissions: { ask: ["Bash(git push)"] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ command: "lint.sh" }, { command: "audit.sh" }] }] },
      },
    },
    { source: "managed", json: { model: "haiku", $schema: "x" } },
  ]);

  it("adds every file's permission rules together, each naming its file", () => {
    expect(layered.permissions).toEqual({
      allow: [
        { value: "Bash(npm test)", source: "user" },
        { value: "Bash(yarn lint)", source: "project" },
      ],
      ask: [{ value: "Bash(git push)", source: "local" }],
      deny: [{ value: "Read(.env)", source: "user" }],
    });
  });

  it("takes each variable and each other key from the strongest file that sets it", () => {
    expect(layered.env).toEqual([
      { name: "A", value: "project", source: "project" },
      { name: "B", value: "user", source: "user" },
    ]);
    expect(layered.other).toEqual([{ key: "model", value: '"haiku"', source: "managed" }]);
  });

  it("lists every file's hooks, one line per matcher with the commands it runs", () => {
    expect(layered.hooks).toEqual([
      { event: "Stop", value: "say done", source: "project" },
      { event: "PreToolUse", value: "Bash: lint.sh ; audit.sh", source: "local" },
    ]);
  });

  it("makes nothing of malformed parts", () => {
    expect(layerSettings("/w", [{ source: "user", json: { permissions: "all", env: ["x"], hooks: { Stop: "nope" } } }])).toEqual({
      cwd: "/w",
      permissions: { allow: [], ask: [], deny: [] },
      env: [],
      hooks: [],
      other: [],
    });
  });
});

describe("readSettings", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("reads the files there are, says which are missing or not JSON objects, and lays the rest", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "mt-settings-"));
    dirs.push(root);
    const write = (relative: string, text: string) => {
      mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      writeFileSync(path.join(root, relative), text);
    };
    write("h/.claude/settings.json", JSON.stringify({ env: { A: "user" } }));
    write("w/app/.claude/settings.json", "{ not json");
    write("w/app/.claude/settings.local.json", "[1, 2]");
    const result = await readSettings(path.join(root, "w/app"), path.join(root, "h/.claude"), "linux");
    expect(result.files.map((file) => `${file.source} ${file.state}`)).toEqual([
      "user ok",
      "project invalid",
      "local invalid",
      expect.stringMatching(/^managed (absent|ok|invalid)$/),
    ]);
    expect(result.env).toContainEqual({ name: "A", value: "user", source: "user" });
  });
});
