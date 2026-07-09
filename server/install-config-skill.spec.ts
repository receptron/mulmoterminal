import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installOwnedSkill, SCHEMA_ASSET_FILE } from "./install-config-skill";

const NAME = "mulmoterminal-config";
const MARKER = ".mt-owned";

let root: string;
let source: string;
let destParent: string;

function makeSource(body: string): string {
  const dir = path.join(root, "src", NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), body);
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mt-skill-"));
  source = makeSource("v1");
  destParent = path.join(root, "skills");
  mkdirSync(destParent, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("installOwnedSkill", () => {
  it("installs into an empty root: copies content, writes the marker + extras", () => {
    expect(installOwnedSkill(source, destParent, { "schema.json": "{}" })).toBe("installed");
    const dest = path.join(destParent, NAME);
    expect(readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("v1");
    expect(existsSync(path.join(dest, MARKER))).toBe(true);
    expect(readFileSync(path.join(dest, "schema.json"), "utf8")).toBe("{}");
  });

  it("refreshes our own copy so shipped edits propagate", () => {
    installOwnedSkill(source, destParent);
    writeFileSync(path.join(source, "SKILL.md"), "v2"); // shipped update
    expect(installOwnedSkill(source, destParent)).toBe("installed");
    expect(readFileSync(path.join(destParent, NAME, "SKILL.md"), "utf8")).toBe("v2");
  });

  it("skips a user's own same-named skill (no marker) and leaves it untouched", () => {
    const userSkill = path.join(destParent, NAME);
    mkdirSync(userSkill, { recursive: true });
    writeFileSync(path.join(userSkill, "SKILL.md"), "mine");
    expect(installOwnedSkill(source, destParent)).toBe("skipped");
    expect(readFileSync(path.join(userSkill, "SKILL.md"), "utf8")).toBe("mine");
    expect(existsSync(path.join(userSkill, MARKER))).toBe(false);
  });

  it("returns absent-source when the bundled skill is missing", () => {
    expect(installOwnedSkill(path.join(root, "nope"), destParent)).toBe("absent-source");
    expect(existsSync(path.join(destParent, NAME))).toBe(false);
  });

  // Regression: a skill dir holding a file named exactly `schema.json` is loaded by the
  // collections engine as a user-scope collection, which then fails validation on every boot.
  it("never ships the schema under the collections-reserved name", () => {
    expect(SCHEMA_ASSET_FILE).not.toBe("schema.json");
  });
});
