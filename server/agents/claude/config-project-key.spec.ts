// @vitest-environment node
import { describe, it, expect } from "vitest";
import path from "node:path";
import { claudeConfigProjectKey } from "./config-project-key";

describe("claudeConfigProjectKey (#3322)", () => {
  // The spelling Claude Code itself writes on Windows, as seen in a reporter's ~/.claude.json.
  it.each([
    ["C:\\Users\\me\\AppData\\Local\\Temp\\mulmoterminal-drops", "C:/Users/me/AppData/Local/Temp/mulmoterminal-drops"],
    ["C:\\work\\myproject", "C:/work/myproject"],
    ["C:\\", "C:/"],
    ["\\\\server\\share\\dir", "//server/share/dir"],
    ["C:/already/forward", "C:/already/forward"],
    ["C:\\mixed/separators\\here", "C:/mixed/separators/here"],
    ["", ""],
  ])("writes %s as %s on Windows", (input, expected) => {
    expect(claudeConfigProjectKey(input, "\\")).toBe(expected);
  });

  // On POSIX a backslash is part of a filename, so rewriting it would name a different folder.
  it.each(["/home/me/work", "/tmp/a\\b", "/", ""])("leaves %s as it is on POSIX", (input) => {
    expect(claudeConfigProjectKey(input, "/")).toBe(input);
  });

  it("follows this platform's separator by default", () => {
    const dir = path.join(path.sep, "x", "y");
    expect(claudeConfigProjectKey(dir)).toBe(path.sep === "\\" ? dir.replaceAll("\\", "/") : dir);
  });
});
