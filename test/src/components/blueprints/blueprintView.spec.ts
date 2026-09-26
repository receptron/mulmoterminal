// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  answerFromInput,
  elapsedParts,
  toolCallSummary,
  basePacks,
  gateKey,
  rejectionReason,
  stepLook,
  toggleChoice,
  usecasesFor,
  waitKey,
  type PackChoice,
} from "../../../../src/components/blueprints/blueprintView";
import { STEP_STATUSES, WAIT_KINDS } from "../../../../common/blueprint/state";
import { BLUEPRINT_GATES } from "../../../../common/blueprint/plan";
import { hearingSchema } from "../../../../common/blueprint/hearing";
import { en } from "../../../../src/i18n/en";
import { ja } from "../../../../src/i18n/ja";

// A message key resolved against a bundle, so a key the helpers name but the bundle lacks is caught.
const lookup = (bundle: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" && part in node ? Reflect.get(node, part) : undefined), bundle);

describe("message keys the helpers name exist in the bundles", () => {
  const keys = [...STEP_STATUSES.map((status) => stepLook(status).labelKey), ...WAIT_KINDS.map((kind) => waitKey(kind) ?? ""), ...BLUEPRINT_GATES.map(gateKey)];

  it.each(keys)("%s", (key) => {
    expect(typeof lookup(en, key)).toBe("string");
    expect(typeof lookup(ja, key)).toBe("string");
  });

  it("names nothing when nothing is waited on", () => {
    expect(waitKey(null)).toBeNull();
  });
});

describe("pack choices", () => {
  const pack = (slug: string, kind: "base" | "usecase", bases: string[] = []): PackChoice => ({
    slug,
    manifest:
      kind === "base"
        ? { kind, slug, title: slug, version: "1", description: "", platform: slug, requires: [], credentials: [] }
        : { kind, slug, title: slug, version: "1", description: "", bases },
  });
  const packs = [
    pack("firebase", "base"),
    pack("supabase", "base"),
    pack("internal", "usecase", ["firebase"]),
    pack("social", "usecase", ["firebase", "supabase"]),
  ];

  it("offers only bases as bases", () => {
    expect(basePacks(packs).map((entry) => entry.slug)).toEqual(["firebase", "supabase"]);
  });

  it("offers only the usecases that support the chosen base", () => {
    expect(usecasesFor(packs, "supabase").map((entry) => entry.slug)).toEqual(["social"]);
    expect(usecasesFor(packs, "firebase").map((entry) => entry.slug)).toEqual(["internal", "social"]);
    expect(usecasesFor(packs, "nothing")).toEqual([]);
  });
});

describe("form input", () => {
  const [text, count] = hearingSchema.parse({
    questions: [
      { id: "t", label: "t", why: "w", kind: "text" },
      { id: "n", label: "n", why: "w", kind: "number" },
    ],
  }).questions;

  it.each([
    ["blank text", text, "   ", undefined],
    ["text", text, "hello", "hello"],
    ["a number", count, "40", 40],
    ["zero", count, "0", 0],
    ["not a number", count, "forty", undefined],
    ["a blank number", count, "", undefined],
  ])("%s", (_label, question, raw, expected) => {
    expect(answerFromInput(question, raw)).toBe(expected);
  });

  it("toggles a multiselect choice on and off, whatever was there before", () => {
    expect(toggleChoice(undefined, "a")).toEqual(["a"]);
    expect(toggleChoice(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleChoice("stray", "a")).toEqual(["a"]);
  });
});

describe("rejectionReason", () => {
  it("shows what a person wrote, and not the machine's word for a failed check", () => {
    expect(rejectionReason({ status: "failed", approved: false, answers: [], reason: "too expensive" })).toBe("too expensive");
    expect(rejectionReason({ status: "failed", approved: true, answers: [], reason: "check failed" })).toBeNull();
    expect(rejectionReason(undefined)).toBeNull();
  });
});

describe("toolCallSummary", () => {
  it.each([
    ["the command a Bash call runs", { command: "yarn test", description: "" }, "yarn test"],
    ["its description over the command", { command: "yarn test --run", description: "Run the tests" }, "Run the tests"],
    ["the file a Read call opens", { file_path: "/p/server/app.ts" }, "/p/server/app.ts"],
    ["a search pattern", { pattern: "TODO", path: "" }, "TODO"],
    ["a plain string input", "hello   world", "hello world"],
    ["nothing it recognises", { other: 1 }, ""],
    ["no input at all", undefined, ""],
  ])("shows %s", (_label, input, expected) => {
    expect(toolCallSummary(input)).toBe(expected);
  });

  it("keeps a long input to one short line", () => {
    const summary = toolCallSummary({ command: `echo ${"x".repeat(500)}\nnext line` });
    expect(summary.length).toBeLessThanOrEqual(120);
    expect(summary).not.toContain("\n");
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("elapsedParts", () => {
  it.each([
    [0, 0, { minutes: 0, seconds: 0 }],
    [0, 59_999, { minutes: 0, seconds: 59 }],
    [0, 133_000, { minutes: 2, seconds: 13 }],
    [5_000, 0, { minutes: 0, seconds: 0 }],
  ])("from %i to %i", (from, to, expected) => {
    expect(elapsedParts(from, to)).toEqual(expected);
  });
});

describe("stepLook motion", () => {
  it("moves only while something is happening or waiting", () => {
    expect(STEP_STATUSES.filter((status) => stepLook(status).motion !== "")).toEqual(["awaiting-approval", "running", "awaiting-answer"]);
  });
});
