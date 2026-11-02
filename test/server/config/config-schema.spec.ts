// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isRecord } from "../../../common/isRecord.js";
import { HEADER_ACTIONS } from "../../../common/headerActions.js";
import {
  dirNameField,
  dirColorField,
  dirThemeField,
  dirColorsField,
  dirFontSizeField,
  dirFontFamilyField,
  dirOrderPriorityField,
  headerButtonSchema,
  headerChipSchema,
  cwdPresetSchema,
  dirConfigJsonSchema,
  NAME_MAX_CHARS,
  MAX_BUTTONS,
  MAX_CHIPS,
  MAX_SKILL_FILTER,
  worktreeEnvSchema,
  dirWorktreeEnvField,
} from "../../../server/config/config-schema";
import { MAX_WORKTREE_ENV_VARS } from "../../../common/worktreeEnv.js";
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from "../../../common/terminalFontSize.js";
import { TERMINAL_FONT_FAMILY_MAX_CHARS } from "../../../common/terminalFontFamily.js";
import { DIR_CONFIG_KEYS } from "../../../common/dirConfigSource";

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
  // Shape only, not existence (#996): a directory may pin a theme the user defined in the global
  // config's `themes`, whose id no schema here can enumerate. Whether the id RESOLVES is decided
  // by loadDirConfig, which can see the configured themes — see dir-config.spec.ts.
  it("accepts any well-formed id", () => {
    expect(dirThemeField.parse("nord")).toBe("nord");
    expect(dirThemeField.parse("solarized")).toBe("solarized");
    expect(dirThemeField.parse("my-dark")).toBe("my-dark");
  });

  it("still refuses a shape that could not be an attribute value", () => {
    expect(dirThemeField.parse("My Dark")).toBeNull();
    expect(dirThemeField.parse("2cool")).toBeNull();
    expect(dirThemeField.parse(7)).toBeNull();
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

describe("dirFontSizeField", () => {
  it("keeps a usable size and rounds a fractional one", () => {
    expect(dirFontSizeField.parse(18)).toBe(18);
    expect(dirFontSizeField.parse(17.6)).toBe(18);
  });

  // The lenient path clamps where the strict schema (writableDirConfigSchema) rejects, so a
  // hand-edited `fontSize: 99` still enlarges the terminal instead of silently doing nothing.
  it("clamps an out-of-range size", () => {
    expect(dirFontSizeField.parse(99)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(dirFontSizeField.parse(2)).toBe(TERMINAL_FONT_SIZE_MIN);
  });

  it("nulls a missing or non-numeric size so the global setting wins", () => {
    expect(dirFontSizeField.parse(undefined)).toBeNull();
    expect(dirFontSizeField.parse(null)).toBeNull();
    expect(dirFontSizeField.parse("16")).toBeNull();
    expect(dirFontSizeField.parse({})).toBeNull();
  });
});

describe("dirFontFamilyField", () => {
  it("keeps a usable stack and normalizes its spacing", () => {
    expect(dirFontFamilyField.parse("'Cica', monospace")).toBe("'Cica', monospace");
    expect(dirFontFamilyField.parse("Cica,monospace")).toBe("Cica, monospace");
  });

  // Rejected whole where dirFontSizeField clamps: half a stack renders in a font nobody named.
  it("nulls a missing or unusable stack so the global setting wins", () => {
    expect(dirFontFamilyField.parse(undefined)).toBeNull();
    expect(dirFontFamilyField.parse(null)).toBeNull();
    expect(dirFontFamilyField.parse("")).toBeNull();
    expect(dirFontFamilyField.parse(16)).toBeNull();
    expect(dirFontFamilyField.parse("Cica; color: red")).toBeNull();
  });
});

describe("dirOrderPriorityField", () => {
  // Unlike the font size this is NOT clamped: every finite integer is a usable rank, so there
  // is no out-of-range to pull back. Negative and zero are ordinary values.
  it("keeps any integer rank, including zero and negatives", () => {
    expect(dirOrderPriorityField.parse(10)).toBe(10);
    expect(dirOrderPriorityField.parse(0)).toBe(0);
    expect(dirOrderPriorityField.parse(-5)).toBe(-5);
    expect(dirOrderPriorityField.parse(999999)).toBe(999999);
  });

  it("nulls anything that isn't an integer, so the directory sorts last", () => {
    expect(dirOrderPriorityField.parse(undefined)).toBeNull();
    expect(dirOrderPriorityField.parse(null)).toBeNull();
    expect(dirOrderPriorityField.parse(1.5)).toBeNull();
    expect(dirOrderPriorityField.parse("3")).toBeNull();
    expect(dirOrderPriorityField.parse(NaN)).toBeNull();
    expect(dirOrderPriorityField.parse({})).toBeNull();
  });
});

describe("dirConfigJsonSchema", () => {
  // The class the key-by-key cases below each caught one instance of (provider/model, fontSize,
  // backgroundImage in #2625): a key the loader honours but the schema omits is one the config skill
  // refuses to write and the Files pane's editor marks as unknown. So the two lists are held equal.
  it("covers exactly the keys a directory's config is read for", () => {
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
    expect(props.sort()).toEqual([...DIR_CONFIG_KEYS].sort());
  });

  it("emits an object schema with every writable property", () => {
    const schema = dirConfigJsonSchema();
    expect(schema.type).toBe("object");
    const { properties } = schema;
    const props = isRecord(properties) ? Object.keys(properties) : [];
    expect(props).toEqual(expect.arrayContaining(["name", "badgeColor", "headerColor", "theme", "colors", "sound", "buttons", "chips", "skills"]));
  });

  // The skill writes a directory's config from this schema, so a key the runtime honours but the
  // schema omits is a key the skill will refuse to write — which is what happened to provider /
  // model between the backend landing (#579) and the picker (#584).
  it("includes the keys that choose a backend, so the config skill can write them", () => {
    const props = isRecord(dirConfigJsonSchema().properties) ? dirConfigJsonSchema().properties : {};
    expect(Object.keys(isRecord(props) ? props : {})).toEqual(expect.arrayContaining(["provider", "model"]));
  });

  // The per-status header colours (#1617), and the part of them that a `.refine` would have lost:
  // z.toJSONSchema drops a refine, so "an entry needs one of the two colours" is written as a union
  // of two shapes. Without the `required` below, the shipped schema accepts `"working": {}` — an
  // entry that says nothing and is then ignored at runtime, which is the silent kind of wrong.
  it("keeps the per-status colours' one-of-two rule in the shipped schema", () => {
    // Bound to a local before guarding: `isRecord(f()) ? f() : {}` calls f twice, and TypeScript
    // cannot narrow the second call from a guard on the first.
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? schema.properties : {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["headerStatusColors", "headerStatusTint"]));
    const colors = isRecord(props.headerStatusColors) ? props.headerStatusColors : {};
    const entry = isRecord(colors.additionalProperties) ? colors.additionalProperties : {};
    const branches: unknown[] = Array.isArray(entry.anyOf) ? entry.anyOf : [];
    const required = branches.flatMap((branch) => (isRecord(branch) && Array.isArray(branch.required) ? branch.required : []));
    expect(required.sort()).toEqual(["background", "text"]);
  });

  // Same reasoning as provider/model above: the config skill writes from this schema, so
  // `fontSize` has to appear here or the skill refuses to write a key the runtime honours.
  // The bounds come along so an editor flags an unusable size while it can still be fixed.
  it("includes fontSize with its bounds, so the config skill can write it", () => {
    const props = isRecord(dirConfigJsonSchema().properties) ? dirConfigJsonSchema().properties : {};
    const fontSize = isRecord(props) && isRecord(props.fontSize) ? props.fontSize : {};
    expect(fontSize.minimum).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(fontSize.maximum).toBe(TERMINAL_FONT_SIZE_MAX);
  });

  // z.toJSONSchema DROPS a `.refine`, so the exact rule can't be carried here — the portable
  // pattern is what stops the skill writing a stack that breaks the CSS declaration.
  it("includes fontFamily with the pattern that rejects CSS syntax", () => {
    const props = isRecord(dirConfigJsonSchema().properties) ? dirConfigJsonSchema().properties : {};
    const fontFamily = isRecord(props) && isRecord(props.fontFamily) ? props.fontFamily : {};
    expect(fontFamily.type).toBe("string");
    expect(fontFamily.maxLength).toBe(TERMINAL_FONT_FAMILY_MAX_CHARS);
    expect(new RegExp(String(fontFamily.pattern)).test("'Cica', monospace")).toBe(true);
    expect(new RegExp(String(fontFamily.pattern)).test("Cica; color: red")).toBe(false);
  });

  // Same reasoning as fontSize/provider above: the config skill writes from this schema, so a
  // key absent here is a key it will refuse to write even though the runtime honours it.
  it("includes orderPriority as an integer, so the config skill can write it", () => {
    const props = isRecord(dirConfigJsonSchema().properties) ? dirConfigJsonSchema().properties : {};
    const orderPriority = isRecord(props) && isRecord(props.orderPriority) ? props.orderPriority : {};
    expect(orderPriority.type).toBe("integer");
  });

  // Same reasoning again (#1062): the loader honours this key, so a schema without it is a key
  // the config skill refuses to write. Boolean-only for now — the planned third value is a
  // string, and blessing one here before the loader accepts it would write a config that loads
  // as "unset" while the skill reports it as written.
  it("includes appendSystemPrompt as a boolean, so the config skill can write it", () => {
    const props = isRecord(dirConfigJsonSchema().properties) ? dirConfigJsonSchema().properties : {};
    const appendSystemPrompt = isRecord(props) && isRecord(props.appendSystemPrompt) ? props.appendSystemPrompt : {};
    expect(appendSystemPrompt.type).toBe("boolean");
  });

  it("caps the skills allowlist at MAX_SKILL_FILTER", () => {
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? schema.properties : {};
    const skills = isRecord(props.skills) ? props.skills : {};
    expect(skills.maxItems).toBe(MAX_SKILL_FILTER);
  });

  // Regression (#748): zod v4's z.record over an enum is exhaustive, so the generated schema
  // marked every palette key `required` — the skill's own `colors: { background }` (one color)
  // then failed self-validation with 22 missing-key errors. partialRecord leaves them optional.
  it("does not require every palette key in the colors schema", () => {
    const props = isRecord(dirConfigJsonSchema().properties) ? dirConfigJsonSchema().properties : {};
    const colors = isRecord(props) && isRecord(props.colors) ? props.colors : {};
    expect(colors.required ?? []).toEqual([]); // a single-color write must validate
  });

  it("buttons require their run payload and chips constrain builtin ids (matches runtime)", () => {
    const json = JSON.stringify(dirConfigJsonSchema());
    expect(json).toContain('"required":["id","label","run","cmd"]'); // shell needs cmd
    expect(json).toContain('"required":["id","label","run","text"]'); // input needs text
    expect(json).toContain('"required":["id","label","run","open"]'); // open needs open
    expect(json).toContain('"required":["id","label","run","action"]'); // action needs action
    expect(json).toContain(`"enum":${JSON.stringify(HEADER_ACTIONS)}`); // …and only the actions the client can dispatch
    expect(json).toContain('"enum":["dir","git","work","ctx","usage","status","diff","tools","env","peer"]'); // chip string = builtin ids only
  });

  // A folder (#2366) is written as id + label + a non-empty `items` of plain buttons, which is what
  // the loader keeps: an empty folder or a nested one would be dropped on load.
  it("buttons may be a folder of at least one button", () => {
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? schema.properties : {};
    const buttons = isRecord(props.buttons) ? props.buttons : {};
    const entry = isRecord(buttons.items) ? buttons.items : {};
    const variants = Array.isArray(entry.anyOf) ? entry.anyOf.filter(isRecord) : [];
    const folder = variants.find((v) => Array.isArray(v.required) && v.required.includes("items"));
    expect(folder?.required).toEqual(["id", "label", "items"]);
    const folderProps = isRecord(folder?.properties) ? folder.properties : {};
    const items = isRecord(folderProps.items) ? folderProps.items : {};
    expect(items.minItems).toBe(1);
    expect(items.maxItems).toBe(MAX_BUTTONS);
    // Its children are the plain-button variant, which requires `run` — so no folder fits inside.
    expect(JSON.stringify(items.items)).not.toContain('"required":["id","label","items"]');
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

  // Same rule for the one cap that is on an OBJECT rather than an array (#1367): the loader
  // slices at MAX_WORKTREE_ENV_VARS, so a schema without the cap would call a 17-variable config
  // valid and let the last one vanish on load. Flagged by Codex review on the #1367 PR.
  it("mirrors the runtime worktreeEnv cap", () => {
    const schema = dirConfigJsonSchema();
    const props = isRecord(schema.properties) ? schema.properties : {};
    const worktreeEnv = isRecord(props.worktreeEnv) ? props.worktreeEnv : {};
    expect(worktreeEnv.maxProperties).toBe(MAX_WORKTREE_ENV_VARS);
  });

  it("refuses one variable past the cap, and accepts exactly the cap", () => {
    const vars = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`P${i}`, { kind: "port", base: 3000 }]));
    expect(worktreeEnvSchema.safeParse(vars(MAX_WORKTREE_ENV_VARS)).success).toBe(true);
    expect(worktreeEnvSchema.safeParse(vars(MAX_WORKTREE_ENV_VARS + 1)).success).toBe(false);
    // …and the boundary the LOADER enforces is the same number, which is the point of mirroring it.
    expect(Object.keys(dirWorktreeEnvField.parse(vars(MAX_WORKTREE_ENV_VARS + 1)) ?? {})).toHaveLength(MAX_WORKTREE_ENV_VARS);
  });

  // The cap has to count what SURVIVES: a malformed entry among the first sixteen used to consume
  // a slot, so a valid seventeenth declaration was never even looked at and the variable the file
  // plainly sets came out unset. (CodeRabbit review on #1367.)
  it("does not let a malformed early entry push a valid later one past the cap", () => {
    const raw: Record<string, unknown> = { BROKEN: { kind: "port", base: 1 } }; // below MIN_PORT
    for (let i = 0; i < MAX_WORKTREE_ENV_VARS; i++) raw[`P${i}`] = { kind: "port", base: 3000 };
    const parsed = dirWorktreeEnvField.parse(raw) ?? {};
    expect(Object.keys(parsed)).toHaveLength(MAX_WORKTREE_ENV_VARS);
    expect(parsed[`P${MAX_WORKTREE_ENV_VARS - 1}`]).toEqual({ kind: "port", base: 3000 });
    expect(parsed.BROKEN).toBeUndefined();
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
