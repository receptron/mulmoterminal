// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseSkillDescription } from "../../../../server/backends/remoteHost/skills.js";

const BOM = "﻿";

describe("parseSkillDescription", () => {
  it("reads the description from valid frontmatter", () => {
    expect(parseSkillDescription("---\nname: x\ndescription: hello world\n---\nbody")).toBe("hello world");
  });

  it("unwraps a quoted description", () => {
    expect(parseSkillDescription('---\ndescription: "quoted value"\n---')).toBe("quoted value");
  });

  it("returns null without an opening fence or a description key", () => {
    expect(parseSkillDescription("no frontmatter here")).toBeNull();
    expect(parseSkillDescription("---\nname: x\n---")).toBeNull(); // no description
    expect(parseSkillDescription("---\ndescription: x")).toBeNull(); // no closing fence
  });

  // Regression (#746): a SKILL.md saved as UTF-8-with-BOM puts U+FEFF before the opening
  // "---", so the fence check failed and the skill silently vanished from the menu.
  it("tolerates a leading UTF-8 BOM", () => {
    expect(parseSkillDescription(`${BOM}---\ndescription: still found\n---`)).toBe("still found");
  });

  // CRLF line endings (a Windows-authored file) must parse the same.
  it("handles CRLF line endings", () => {
    expect(parseSkillDescription("---\r\ndescription: crlf ok\r\n---\r\n")).toBe("crlf ok");
  });
});
