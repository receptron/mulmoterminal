import { describe, it, expect } from "vitest";
import {
  DIR_FORM_FIELDS,
  DIR_FORM_HEADER_KEYS,
  DIR_FORM_LIST_KEYS,
  DIR_FORM_MEDIA_KEYS,
  DIR_FORM_MODEL_KEYS,
  DIR_FORM_SET_KEYS,
  currentModelChoice,
  editForInput,
  editForModelChoice,
  editForSet,
  inputText,
  type DirFormField,
} from "../../../src/components/dirSettingsFormFields";
import { DIR_FORM_KEYS } from "../../../common/dirConfigForm";
import { DIR_CONFIG_KEYS } from "../../../common/dirConfigSource";

const field = (key: DirFormField["key"]): DirFormField => {
  const found = DIR_FORM_FIELDS.find((entry) => entry.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
};

describe("DIR_FORM_FIELDS", () => {
  it("covers every form key exactly once, as a one-input row or a whole-set editor", () => {
    expect(
      [
        ...DIR_FORM_FIELDS.map((entry) => entry.key),
        ...DIR_FORM_SET_KEYS,
        ...DIR_FORM_MODEL_KEYS,
        ...DIR_FORM_MEDIA_KEYS,
        ...DIR_FORM_HEADER_KEYS,
        ...DIR_FORM_LIST_KEYS,
      ].sort(),
    ).toEqual([...DIR_FORM_KEYS].sort());
  });
});

// Every key a directory's config holds can be set from the form (#2722). A key added to the loader
// fails here until the form offers it — or until this says, with a reason, why it does not.
// `mobileFiles` decides what leaves this machine for the phone (#2911); it is written in the file
// on purpose, where a reviewer of the repository sees it, rather than clicked on in a form.
// `review` (#3407) for the same reason: it picks which agent reviews and when a PR counts as mergeable.
const NOT_IN_FORM = ["mobileFiles", "review"];

describe("DIR_FORM_KEYS", () => {
  it("is every key the loader reads", () => {
    expect([...DIR_FORM_KEYS].sort()).toEqual([...DIR_CONFIG_KEYS].filter((key) => !NOT_IN_FORM.includes(key)).sort());
  });
});

describe("editForInput", () => {
  it.each([
    ["name", "  shop ", { set: { name: "shop" }, unset: [] }],
    ["name", "   ", { set: {}, unset: ["name"] }],
    ["fontFamily", "Menlo", { set: { fontFamily: "Menlo" }, unset: [] }],
    ["theme", "dark", { set: { theme: "dark" }, unset: [] }],
    ["theme", "", { set: {}, unset: ["theme"] }],
    ["headerStatusTint", "none", { set: { headerStatusTint: "none" }, unset: [] }],
    ["headerStatusTint", "", { set: {}, unset: ["headerStatusTint"] }],
    ["appendSystemPrompt", "true", { set: { appendSystemPrompt: true }, unset: [] }],
    ["appendSystemPrompt", "false", { set: { appendSystemPrompt: false }, unset: [] }],
    ["appendSystemPrompt", "", { set: {}, unset: ["appendSystemPrompt"] }],
    ["fontSize", "14", { set: { fontSize: 14 }, unset: [] }],
    ["fontSize", "", { set: {}, unset: ["fontSize"] }],
    ["orderPriority", "-2", { set: { orderPriority: -2 }, unset: [] }],
    ["headerColor", "#AABBCC", { set: { headerColor: "#aabbcc" }, unset: [] }],
  ] as const)("%s %j", (key, raw, edit) => {
    expect(editForInput(field(key), raw)).toEqual(edit);
  });

  it.each([
    ["fontSize", "14.5"],
    ["fontSize", "abc"],
    ["orderPriority", "1e400"],
    ["headerColor", ""],
    ["headerColor", "#abc"],
    ["headerColor", "red"],
    ["appendSystemPrompt", "yes"],
  ] as const)("refuses %s %j", (key, raw) => {
    expect(editForInput(field(key), raw)).toBeNull();
  });
});

describe("inputText", () => {
  it.each([
    ["name", "shop", "shop"],
    ["name", 3, ""],
    ["name", undefined, ""],
    ["fontSize", 14, "14"],
    ["fontSize", "14", ""],
    ["fontSize", Number.NaN, ""],
    ["headerColor", "#112233", "#112233"],
    ["appendSystemPrompt", false, "false"],
    ["appendSystemPrompt", "false", ""],
  ] as const)("%s %j -> %j", (key, value, text) => {
    expect(inputText(field(key), value)).toBe(text);
  });
});

describe("editForSet", () => {
  it("writes a set that holds anything", () => {
    expect(editForSet("colors", { background: "#000000" })).toEqual({ set: { colors: { background: "#000000" } }, unset: [] });
  });

  it("takes an emptied set out of the file, so the global one applies again", () => {
    expect(editForSet("headerStatusColors", {})).toEqual({ set: {}, unset: ["headerStatusColors"] });
  });
});

describe("editForSet on a list", () => {
  it("writes a list that holds anything, and takes an empty one out", () => {
    expect(editForSet("addDirs", ["../a"])).toEqual({ set: { addDirs: ["../a"] }, unset: [] });
    expect(editForSet("addDirs", [])).toEqual({ set: {}, unset: ["addDirs"] });
  });
});

describe("the model choice", () => {
  it.each([
    [{}, ""],
    [{ provider: "router", model: "vendor/big" }, "router|vendor/big"],
    [{ model: "claude-x" }, "|claude-x"],
    [{ provider: "router" }, "router|"],
    [{ provider: 3, model: null }, ""],
  ])("reads %j as %j", (values, choice) => {
    expect(currentModelChoice(values)).toBe(choice);
  });

  it.each([
    ["", { set: {}, unset: ["provider", "model"] }],
    ["router|vendor/big", { set: { provider: "router", model: "vendor/big" }, unset: [] }],
    ["|claude-x", { set: { model: "claude-x" }, unset: ["provider"] }],
    ["router|", { set: { provider: "router" }, unset: ["model"] }],
    ["router|vendor/a|b", { set: { provider: "router", model: "vendor/a|b" }, unset: [] }],
  ])("saves %j as %j", (choice, edit) => {
    expect(editForModelChoice(choice)).toEqual(edit);
  });

  it("reads back what it saves", () => {
    const edit = editForModelChoice("router|vendor/big");
    expect(currentModelChoice(edit.set)).toBe("router|vendor/big");
  });
});
