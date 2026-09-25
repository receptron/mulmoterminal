// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  answerFromInput,
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
