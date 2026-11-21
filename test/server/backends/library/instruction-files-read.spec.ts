// @vitest-environment node
// Reading the instruction files Claude Code loads for a directory (#3332), on a real tree.
import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fsPromises } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMPORTS_PER_FILE_MAX, readInstructions, RULES_PER_FOLDER_MAX } from "../../../../server/backends/library/instruction-files-read";
import { INSTRUCTION_FILE_MAX_BYTES } from "../../../../common/libraryTools";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tree(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "mt-instructions-"));
  dirs.push(root);
  Object.entries(files).forEach(([relative, text]) => {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  });
  const at = (relative: string) => path.join(root, relative);
  const read = () => readInstructions(at("w/app"), at("h/.claude"), at("h"), process.platform === "win32" ? "win32" : "linux");
  const listed = async () =>
    (await read()).files.filter((file) => file.path.startsWith(root)).map((file) => `${file.scope} ${path.relative(root, file.path)} ${file.loads}`);
  return { at, read, listed };
}

describe("readInstructions", () => {
  it("lists what exists in Claude Code's order: user, user rules, each directory down, project rules", async () => {
    const { listed, read } = tree({
      "h/.claude/CLAUDE.md": "user\n",
      "h/.claude/rules/style.md": "be brief\n",
      "w/CLAUDE.md": "parent\n",
      "w/app/CLAUDE.md": "one\ntwo\n",
      "w/app/.claude/CLAUDE.md": "project\n",
      "w/app/CLAUDE.local.md": "mine\n",
      "w/app/.claude/rules/b/api.md": '---\npaths:\n  - "src/**"\n---\napi\n',
      "w/app/.claude/rules/a.md": "always\n",
    });
    expect(await listed()).toEqual([
      "user h/.claude/CLAUDE.md launch",
      "user-rule h/.claude/rules/style.md launch",
      "directory w/CLAUDE.md launch",
      "directory w/app/CLAUDE.md launch",
      "project w/app/.claude/CLAUDE.md launch",
      "local w/app/CLAUDE.local.md launch",
      "rule w/app/.claude/rules/a.md launch",
      "rule w/app/.claude/rules/b/api.md on-demand",
    ]);
    const own = (await read()).files.find((file) => file.path.endsWith(path.join("w", "app", "CLAUDE.md")));
    expect(own).toMatchObject({ lines: 2, bytes: 8, state: "ok", importedBy: null });
    expect((await read()).agentsMd).toBe(false);
  });

  it("follows imports in place, at most four hops, each file once", async () => {
    const { listed } = tree({
      "w/app/CLAUDE.md": "@one.md and @one.md",
      "w/app/one.md": "@two.md",
      "w/app/two.md": "@three.md and back to @one.md",
      "w/app/three.md": "@four.md",
      "w/app/four.md": "@five.md",
      "w/app/five.md": "too deep",
      "w/app/CLAUDE.local.md": "after the imports",
    });
    expect(await listed()).toEqual([
      "directory w/app/CLAUDE.md launch",
      "import w/app/one.md launch",
      "import w/app/two.md launch",
      "import w/app/three.md launch",
      "import w/app/four.md launch",
      "local w/app/CLAUDE.local.md launch",
    ]);
  });

  it("lists a file too large for Claude Code as skipped, unread", async () => {
    const { read } = tree({ "w/app/CLAUDE.md": "x".repeat(INSTRUCTION_FILE_MAX_BYTES + 1) });
    expect((await read()).files.find((file) => file.scope === "directory")).toMatchObject({ state: "too-large", lines: 0 });
  });

  it("reads AGENTS.md where no CLAUDE.md counts, the user's still loading beside it", async () => {
    const { listed, read } = tree({ "h/.claude/CLAUDE.md": "user", "w/AGENTS.md": "parent agents", "w/app/.claude/AGENTS.md": "agents" });
    expect(await listed()).toEqual(["user h/.claude/CLAUDE.md launch", "agents w/AGENTS.md launch", "agents w/app/.claude/AGENTS.md launch"]);
    expect((await read()).agentsMd).toBe(true);
  });

  it("does not read AGENTS.md where a CLAUDE.local.md counts", async () => {
    const { listed } = tree({ "w/CLAUDE.local.md": "mine", "w/app/AGENTS.md": "agents" });
    expect(await listed()).toEqual(["local w/CLAUDE.local.md launch"]);
  });

  it.skipIf(process.platform === "win32")("follows a linked rule and a linked rules folder, each real folder once", async () => {
    const { at, listed } = tree({ "shared/security.md": "shared", "shared/more/api.md": "api", "w/app/.claude/rules/own.md": "own" });
    symlinkSync(at("shared/security.md"), at("w/app/.claude/rules/security.md"));
    symlinkSync(at("shared"), at("w/app/.claude/rules/shared"));
    symlinkSync(at("w/app/.claude/rules"), at("shared/loop"));
    const rules = (await listed()).filter((line) => line.startsWith("rule "));
    expect(rules).toEqual([
      "rule w/app/.claude/rules/own.md launch",
      // linked in from outside the directory: Claude Code loads these once external imports are approved
      "rule w/app/.claude/rules/security.md approval",
      "rule w/app/.claude/rules/shared/more/api.md approval",
      "rule w/app/.claude/rules/shared/security.md approval",
    ]);
  });

  it("follows at most so many imports from one file, and says when the listing stopped at its bound", async () => {
    const imports = Array.from({ length: IMPORTS_PER_FILE_MAX + 20 }, (_, n) => `@i${String(n)}.md`).join("\n");
    const files: Record<string, string> = { "w/app/CLAUDE.md": imports };
    Array.from({ length: IMPORTS_PER_FILE_MAX + 20 }, (_, n) => (files[`w/app/i${String(n)}.md`] = "x"));
    const { read } = tree(files);
    const result = await read();
    expect(result.files.filter((file) => file.scope === "import")).toHaveLength(IMPORTS_PER_FILE_MAX);
    expect(result.truncated).toBe(false);
    const many: Record<string, string> = {};
    Array.from({ length: RULES_PER_FOLDER_MAX }, (_, n) => {
      many[`h/.claude/rules/u${String(n)}.md`] = "u";
      many[`w/app/.claude/rules/p${String(n)}.md`] = "p";
    });
    expect((await tree(many).read()).truncated).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "marks what is linked or imported from outside the directory as needing approval, and never follows a network path",
    async () => {
      const { at, read } = tree({
        "shared/always.md": "always",
        "shared/scoped.md": "---\npaths: src/**\n---\nscoped",
        "outside/notes.md": "notes",
        "w/app/CLAUDE.md": "@../../outside/notes.md and @/net/host/x.md",
        "w/app/.claude/rules/own.md": "own",
        "w/CLAUDE.md": "@../outside/notes.md",
      });
      symlinkSync(at("shared/always.md"), at("w/app/.claude/rules/always.md"));
      symlinkSync(at("shared/scoped.md"), at("w/app/.claude/rules/scoped.md"));
      symlinkSync("/net/host/rules", at("w/app/.claude/rules/network"));
      // Spies that call through: what matters is that a network target is never looked up at all.
      const stat = vi.spyOn(fsPromises, "stat");
      const realpath = vi.spyOn(fsPromises, "realpath");
      const files = (await read()).files.filter((file) => file.path.startsWith(at("")));
      const looked = [...stat.mock.calls, ...realpath.mock.calls].map(([target]) => String(target));
      stat.mockRestore();
      realpath.mockRestore();
      expect(looked.filter((target) => target.startsWith("/net") || target.endsWith(path.join("rules", "network")))).toEqual([]);
      const shown = files.map((file) => `${file.scope} ${path.relative(at(""), file.path)} ${file.loads}`);
      expect(shown).toEqual([
        "directory w/CLAUDE.md launch",
        "import outside/notes.md launch", // from a parent directory's file, as it loads
        "directory w/app/CLAUDE.md launch",
        "rule w/app/.claude/rules/always.md approval",
        "rule w/app/.claude/rules/own.md launch",
      ]);
    },
  );

  it("marks an import from the project to outside it as needing approval", async () => {
    const { at, read } = tree({ "w/app/CLAUDE.md": "@../../outside/notes.md", "outside/notes.md": "notes" });
    const imported = (await read()).files.find((file) => file.path === at("outside/notes.md"));
    expect(imported?.loads).toBe("approval");
  });
});
