// @vitest-environment node
// Which instruction files Claude Code loads for a directory, in its order (#3332), and their imports.
import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  agentsCandidates,
  directoriesDown,
  importsOf,
  isInside,
  isNetworkPath,
  isPathScopedRule,
  launchCandidates,
  managedInstructionFile,
} from "../../../../server/backends/library/instruction-files";

describe("directoriesDown", () => {
  it("is the filesystem root first, the working directory last", () => {
    expect(directoriesDown("/w/app")).toEqual(["/", "/w", "/w/app"]);
    expect(directoriesDown("/")).toEqual(["/"]);
    expect(directoriesDown("C:\\w\\app", path.win32)).toEqual(["C:\\", "C:\\w", "C:\\w\\app"]);
  });
});

describe("launchCandidates", () => {
  it("lists the managed file, the user's and their rules, each directory down, and the project's rules", () => {
    expect(launchCandidates("/w/app", "/h/.claude", "linux").map(({ scope, path: file }) => `${scope} ${file}`)).toEqual([
      "managed /etc/claude-code/CLAUDE.md",
      "user /h/.claude/CLAUDE.md",
      "user-rule /h/.claude/rules",
      "directory /CLAUDE.md",
      "local /CLAUDE.local.md",
      "directory /w/CLAUDE.md",
      "local /w/CLAUDE.local.md",
      "directory /w/app/CLAUDE.md",
      "project /w/app/.claude/CLAUDE.md",
      "local /w/app/CLAUDE.local.md",
      "rule /w/app/.claude/rules",
    ]);
  });
  it("puts the managed file where each system keeps it, and builds Windows paths the Windows way", () => {
    expect(managedInstructionFile("darwin")).toBe("/Library/Application Support/ClaudeCode/CLAUDE.md");
    expect(managedInstructionFile("win32")).toBe("C:\\Program Files\\ClaudeCode\\CLAUDE.md");
    expect(managedInstructionFile("linux")).toBe("/etc/claude-code/CLAUDE.md");
    expect(launchCandidates("C:\\w", "C:\\h\\.claude", "win32").at(-1)?.path).toBe("C:\\w\\.claude\\rules");
  });
});

describe("agentsCandidates", () => {
  it("reads AGENTS.md and .claude/AGENTS.md in each directory down", () => {
    expect(agentsCandidates("/w", "linux").map((candidate) => candidate.path)).toEqual([
      "/AGENTS.md",
      "/.claude/AGENTS.md",
      "/w/AGENTS.md",
      "/w/.claude/AGENTS.md",
    ]);
  });
});

describe("importsOf", () => {
  const from = "/w/app/CLAUDE.md";
  it("resolves imports against the file's folder, `~/` against the home, and keeps an escaped space", () => {
    expect(importsOf("See @README.md and @docs/guide.md, also @~/notes.md and @/abs/x.md.\n- @Design\\ Docs/api.md", from, "/h")).toEqual([
      "/w/app/README.md",
      "/w/app/docs/guide.md",
      "/h/notes.md",
      "/abs/x.md",
      "/w/app/Design Docs/api.md",
    ]);
  });
  it.each([
    ["@README.md", "/w/app/README.md"],
    ["@README.md.", "/w/app/README.md"],
    ["@docs/v1.2/guide.md,", "/w/app/docs/v1.2/guide.md"],
    ["see @a.b.c.md)", "/w/app/a.b.c.md"],
  ])("trims only the punctuation closing a sentence: %s", (text, imported) => {
    expect(importsOf(text, from, "/h")).toEqual([imported]);
  });
  it("stops reading imports at the limit, distinct ones in the order written", () => {
    expect(importsOf("@a.md @a.md @b.md @c.md @d.md", from, "/h", path, 2)).toEqual(["/w/app/a.md", "/w/app/b.md"]);
  });
  it("reads Windows imports whole, backslashes and all", () => {
    expect(importsOf("@C:\\shared\\guide.md and @docs\\guide.md", "C:\\w\\CLAUDE.md", "C:\\h", path.win32)).toEqual([
      "C:\\shared\\guide.md",
      "C:\\w\\docs\\guide.md",
    ]);
  });
  it("leaves out an import inside quotes, either style, as Claude Code does", () => {
    expect(importsOf(`"@README.md" and '@docs/guide.md' but @plain.md`, from, "/h")).toEqual(["/w/app/plain.md"]);
  });
  it("ignores code, quoted paths, addresses and a bare @", () => {
    expect(importsOf('`@README` and\n```\n@inside.md\n```\nmail me@example.com, @"Design Docs/quoted.md", @ alone', from, "/h")).toEqual([]);
  });
});

describe("isPathScopedRule", () => {
  it("is a rule with a paths field in its frontmatter", () => {
    expect(isPathScopedRule('---\npaths:\n  - "src/**/*.ts"\n---\nUse strict types.')).toBe(true);
    expect(isPathScopedRule("---\r\npaths: src/**\r\n---\r\nx")).toBe(true);
  });
  it.each([
    ["no frontmatter", "Use strict types."],
    ["another field", "---\ntitle: x\n---\npaths: not frontmatter"],
    ["an unclosed frontmatter", "---\npaths: x\n"],
    ["empty", ""],
  ])("is not one with %s", (_label, text) => {
    expect(isPathScopedRule(text)).toBe(false);
  });
});

describe("isNetworkPath", () => {
  it.each(["\\\\server\\share\\rules", "//server/share/project", "/\\server\\share", "/net/host/rules", "/Network/Servers/x", "/net"])(
    "%s is one",
    (target) => {
      expect(isNetworkPath(target)).toBe(true);
    },
  );
  it.each(["\\\\wsl$\\Ubuntu\\home", "\\\\WSL$\\x", "//wsl$/Ubuntu", "///tmp/x", "/network/x", "/netlify/x", "/home/me/net/x", "C:\\net\\x"])(
    "%s is not",
    (target) => {
      expect(isNetworkPath(target)).toBe(false);
    },
  );
});

describe("isInside", () => {
  it("is the directory itself or below it, by either separator, and not a sibling with the same start", () => {
    expect([isInside("/w/app", "/w/app"), isInside("/w/app", "/w/app/a.md"), isInside("C:\\w", "C:\\w\\a.md")]).toEqual([true, true, true]);
    expect([isInside("/w/app", "/w/application/a.md"), isInside("/w/app", "/w/a.md")]).toEqual([false, false]);
    expect([isInside("/", "/w/a.md"), isInside("C:\\", "C:\\project\\x.md"), isInside("C:\\", "D:\\x.md")]).toEqual([true, true, false]);
  });
});
