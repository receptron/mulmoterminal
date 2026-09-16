// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installOwnedSkill, SCHEMA_ASSET_FILE } from "../../../server/infra/install-bundled-skills";
import { BUNDLED_SKILL_NAMES } from "../../../common/bundledSkills.js";
import { loadDirConfig } from "../../../server/config/dir-config";
import { isRecord } from "../../../common/isRecord.js";

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

  // Flagged by Codex on #821, the same stale-overlay class as syncCodexSkills: copying on top
  // of a copy we could not remove leaves whatever the bundle has since dropped in place while
  // reporting it as installed. `unreplaceable` is its own outcome — nobody else owns the
  // directory, we simply could not replace it.
  //
  // The state it models (something still holding the directory) is Windows-only, and chmod
  // cannot produce it there, so the case is driven the POSIX way.
  it.skipIf(process.platform === "win32")("reports unreplaceable rather than overlaying a copy it could not remove", () => {
    installOwnedSkill(source, destParent);
    // A file only the SECOND copy could bring. Asserting on one that exists in BOTH would
    // depend on how far rmSync got before failing — it may or may not empty the directory
    // first, and that differs between machines (this test passed locally and failed in CI on
    // exactly that).
    writeFileSync(path.join(source, "new-in-bundle.md"), "shipped later");
    chmodSync(destParent, 0o500);
    try {
      expect(installOwnedSkill(source, destParent)).toBe("unreplaceable");
    } finally {
      chmodSync(destParent, 0o700);
    }
    expect(existsSync(path.join(destParent, path.basename(source), "new-in-bundle.md"))).toBe(false);
  });

  // Regression: a skill dir holding a file named exactly `schema.json` is loaded by the
  // collections engine as a user-scope collection, which then fails validation on every boot.
  it("never ships the schema under the collections-reserved name", () => {
    expect(SCHEMA_ASSET_FILE).not.toBe("schema.json");
  });
});
const CHROME_KEYS = ["badgeColor", "headerColor", "headerTextColor", "cellColor", "cellBorderColor", "dotColor", "buttonColor"] as const;
const META_KEYS = ["id", "vibe", "label", "description"];

// The skill offers these as starting points, so a typo'd hex would silently ship a colour the loader
// drops — the user picks a preset and part of it just doesn't apply.
describe("shipped colour presets (palettes.json)", () => {
  const file = path.join(process.cwd(), "server", "skills", "mulmoterminal-dirs", "palettes.json");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const presets: unknown[] = isRecord(parsed) && Array.isArray(parsed.presets) ? parsed.presets : [];

  it("ships at least one preset per vibe the skill asks about", () => {
    expect(presets.map((p) => (isRecord(p) ? p.vibe : null))).toEqual(expect.arrayContaining(["warm", "cool", "bold", "neutral"]));
  });

  for (const preset of presets) {
    const id = isRecord(preset) && typeof preset.id === "string" ? preset.id : "(unnamed)";
    it(`preset ${id} survives the loader with nothing dropped`, () => {
      expect(isRecord(preset)).toBe(true);
      if (!isRecord(preset)) return;
      const config: Record<string, unknown> = Object.fromEntries(Object.entries(preset).filter(([k]) => !META_KEYS.includes(k)));

      const dir = mkdtempSync(path.join(tmpdir(), "mt-preset-"));
      writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify(config));
      const loaded = loadDirConfig(dir);
      rmSync(dir, { recursive: true, force: true });

      expect(loaded.theme).toBe(config.theme); // theme id is a real one
      // Sorted: the loader re-emits palette keys in ITheme order, not the file's order.
      const wantedColors = isRecord(config.colors) ? Object.keys(config.colors).sort() : [];
      expect(Object.keys(loaded.colors ?? {}).sort()).toEqual(wantedColors); // every palette key valid
      CHROME_KEYS.forEach((key) => {
        if (config[key] !== undefined) expect(loaded[key]).not.toBeNull();
      });
    });
  }
});

// Every name in the list has to resolve to a real directory that ships: the installer copies by
// name, so a typo or a renamed directory silently leaves the user without that skill — there is no
// error, the slash command just never appears.
describe("BUNDLED_SKILL_NAMES", () => {
  it("names more than one skill (the installer used to be hardwired to the config one)", () => {
    expect(BUNDLED_SKILL_NAMES.length).toBeGreaterThan(1);
  });

  for (const name of BUNDLED_SKILL_NAMES) {
    it(`${name} ships a directory with a SKILL.md whose frontmatter name matches`, () => {
      const skill = readFileSync(path.join(process.cwd(), "server", "skills", name, "SKILL.md"), "utf8");
      expect(skill).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
    });
  }

  // The reverse of the check above, and the failure mode the split introduced: adding a skill
  // directory is not what ships it. A directory nobody lists is copied nowhere, so the slash
  // command simply never exists — with no error at any point.
  it("ships every skill directory under server/skills", () => {
    const root = path.join(process.cwd(), "server", "skills");
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect([...dirs].sort()).toEqual([...BUNDLED_SKILL_NAMES].sort());
  });
});

const skillBody = (name: string): string => readFileSync(path.join(process.cwd(), "server", "skills", name, "SKILL.md"), "utf8");
const frontmatterDescription = (body: string): string => body.match(/^description: (.*)$/m)?.[1] ?? "";

describe("bundled SKILL.md frontmatter", () => {
  for (const name of BUNDLED_SKILL_NAMES) {
    // Skill selection is made from the description alone. An empty one is not a skill that is
    // merely hard to find — it is one the model has no basis to pick over any other.
    it(`${name} describes itself`, () => {
      expect(frontmatterDescription(skillBody(name)).trim().length).toBeGreaterThan(0);
    });

    // A raw control byte survives every check we have -- it type-checks, lints, and renders as
    // nothing -- while destroying the one thing the text was carrying. The `keymap.send` table
    // documents ESC and Ctrl-A as the six-character ESCAPE TEXT a user types into JSON; writing
    // the bytes themselves turns a table of what to type into invisible whitespace.
    it(`${name} carries no raw control characters`, () => {
      const control = [...skillBody(name)].filter((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return (code < 0x20 && ch !== "\n" && ch !== "\t") || code === 0x7f;
      });
      expect(control).toEqual([]);
    });
  }
});

// The router names its siblings in prose, so a renamed or dropped skill leaves it pointing at
// something that does not exist — and the user is told to run a command that isn't there.
describe("mulmoterminal-config routes to skills that exist", () => {
  const routed = (): string[] => {
    const named = new Set(skillBody("mulmoterminal-config").match(/mulmoterminal-[a-z-]+/g) ?? []);
    named.delete("mulmoterminal-config"); // its own name, in the frontmatter and headings
    return [...named].sort();
  };

  it("names no skill that isn't bundled", () => {
    expect(routed().filter((name) => !BUNDLED_SKILL_NAMES.some((bundled) => bundled === name))).toEqual([]);
  });

  // Each writing skill has to be reachable from the entry point, or the only way to find it is to
  // already know its name — which defeats having an entry point at all.
  //
  // A SUPERSET, not an equality. Equality was the convenient way to write "every writer is named",
  // but it also forbade naming a non-writer, and the router has a real reason to: it owns
  // `decisionDigest` (the switch) while `mulmoterminal-decisions` is what READS the digest, so a
  // reader who turns it on needs to be told where the result is consumed. Naming a skill that does
  // not ship is still caught, by the test above.
  it("routes to every skill that writes settings", () => {
    // The three that are not settings at all, and one that is not MulmoTerminal's settings:
    // `mulmoterminal-shared-app` builds the user's own app — it writes that repository's `app.json`
    // and its collections, never anything the router is a table of contents for. Routing to it
    // would put "make a survey" in a list of places to change fonts and keybindings, and the agent
    // finds it the way it finds any skill: by what the user asked for.
    const notSettings = ["bot", "mulmoterminal-config", "mulmoterminal-bug-report", "mulmoterminal-decisions", "mulmoterminal-shared-app"];
    const writers = BUNDLED_SKILL_NAMES.filter((name) => !notSettings.some((excluded) => excluded === name));
    expect(writers.filter((name) => !routed().includes(name))).toEqual([]);
  });
});
