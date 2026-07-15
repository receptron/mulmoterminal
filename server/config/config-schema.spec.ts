import { describe, it, expect } from "vitest";
import {
  dirNameField,
  dirColorField,
  dirThemeField,
  dirColorsField,
  headerButtonSchema,
  headerChipSchema,
  cwdPresetSchema,
  dirConfigJsonSchema,
  NAME_MAX_CHARS,
  MAX_BUTTONS,
  MAX_CHIPS,
  MAX_SKILL_FILTER,
} from "./config-schema";

describe("dirNameField", () => {
  it("trims and caps at NAME_MAX_CHARS", () => {
    expect(dirNameField.parse("  PROD  ")).toBe("PROD");
    expect(dirNameField.parse("x".repeat(100))).toHaveLength(NAME_MAX_CHARS);
  });
  it("returns null for empty / whitespace / non-string / null", () => {
    expect(dirNameField.parse("")).toBeNull();
    expect(dirNameField.parse("   ")).toBeNull();
    expect(dirNameField.parse(42)).toBeNull();
    expect(dirNameField.parse(null)).toBeNull();
    expect(dirNameField.parse(undefined)).toBeNull();
  });
});

describe("dirColorField", () => {
  it("lowercases a #rrggbb color, else null", () => {
    expect(dirColorField.parse("#CF222E")).toBe("#cf222e");
    expect(dirColorField.parse("  #FFFFFF ")).toBe("#ffffff");
    expect(dirColorField.parse("red")).toBeNull();
    expect(dirColorField.parse("#fff")).toBeNull(); // shorthand not accepted for chrome colors
    expect(dirColorField.parse(5)).toBeNull();
  });
});

describe("dirThemeField", () => {
  it("accepts a known theme id, else null", () => {
    expect(dirThemeField.parse("nord")).toBe("nord");
    expect(dirThemeField.parse("solarized")).toBe("solarized");
    expect(dirThemeField.parse("solarized-light")).toBeNull(); // the correct id is `solarized`
    expect(dirThemeField.parse("neon")).toBeNull();
  });
});

describe("dirColorsField", () => {
  it("keeps known palette keys (incl. #rgb) and drops unknown keys / bad values", () => {
    expect(dirColorsField.parse({ background: "#190A23", cursor: "#FFF", foreground: "rgb(1,2,3)", bogus: "#000000", red: "# abc" })).toEqual({
      background: "#190a23",
      cursor: "#fff",
    });
  });
  it("nulls a block with nothing valid, and a non-object", () => {
    expect(dirColorsField.parse({ nope: "#fff", foreground: "red" })).toBeNull();
    expect(dirColorsField.parse("x")).toBeNull();
    expect(dirColorsField.parse(undefined)).toBeNull();
  });
});

describe("item schemas (strict shape)", () => {
  it("headerButtonSchema accepts a well-formed button", () => {
    const parsed = headerButtonSchema.parse({ id: "lint", label: "Lint", run: "shell", cmd: "yarn lint" });
    expect(parsed).toEqual({ id: "lint", label: "Lint", run: "shell", cmd: "yarn lint" });
  });
  it("headerButtonSchema rejects an unknown run type", () => {
    expect(headerButtonSchema.safeParse({ id: "a", label: "A", run: "nope" }).success).toBe(false);
  });
  it("headerChipSchema accepts a builtin string and a custom object", () => {
    expect(headerChipSchema.parse("git")).toBe("git");
    expect(headerChipSchema.parse({ label: "↑↓", text: "${ahead}" })).toEqual({ label: "↑↓", text: "${ahead}" });
  });
  it("cwdPresetSchema requires label + path strings", () => {
    expect(cwdPresetSchema.safeParse({ label: "x", path: "/x" }).success).toBe(true);
    expect(cwdPresetSchema.safeParse({ label: "x" }).success).toBe(false);
  });
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

describe("dirConfigJsonSchema", () => {
  it("emits an object schema with every writable property", () => {
    const schema = dirConfigJsonSchema();
    expect(schema.type).toBe("object");
    const { properties } = schema;
    const props = isRecord(properties) ? Object.keys(properties) : [];
    expect(props).toEqual(expect.arrayContaining(["name", "badgeColor", "headerColor", "theme", "colors", "sound", "buttons", "chips", "skills"]));
  });

  it("caps the skills allowlist at MAX_SKILL_FILTER", () => {
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? schema.properties : {};
    const skills = isRecord(props.skills) ? props.skills : {};
    expect(skills.maxItems).toBe(MAX_SKILL_FILTER);
  });

  it("buttons require their run payload and chips constrain builtin ids (matches runtime)", () => {
    const json = JSON.stringify(dirConfigJsonSchema());
    expect(json).toContain('"required":["id","label","run","cmd"]'); // shell needs cmd
    expect(json).toContain('"required":["id","label","run","text"]'); // input needs text
    expect(json).toContain('"required":["id","label","run","open"]'); // open needs open
    expect(json).toContain('"enum":["dir","git","ctx","usage","status","diff","tools"]'); // chip string = builtin ids only
  });

  // The runtime truncates past these caps and drops whitespace-only strings, so a schema that
  // allowed them would bless configs whose tail (or whose button) silently disappears on load.
  it("mirrors the runtime array caps", () => {
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? schema.properties : {};
    const buttons = isRecord(props.buttons) ? props.buttons : {};
    const chips = isRecord(props.chips) ? props.chips : {};
    expect(buttons.maxItems).toBe(MAX_BUTTONS);
    expect(chips.maxItems).toBe(MAX_CHIPS);
  });

  it("rejects whitespace-only strings the runtime would drop", () => {
    const json = JSON.stringify(dirConfigJsonSchema());
    // every free-text field carries minLength + a non-whitespace pattern
    expect(json).not.toContain('"cmd":{"type":"string"}'); // i.e. never an unconstrained string
    expect(json).toContain('"minLength":1,"pattern":"\\\\S"');
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? schema.properties : {};
    const name = isRecord(props.name) ? props.name : {};
    expect(name.minLength).toBe(1);
    expect(name.maxLength).toBe(NAME_MAX_CHARS);
    expect(name.pattern).toBe("\\S");
  });
});
