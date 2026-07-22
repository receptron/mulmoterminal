// @vitest-environment node
import { describe, it, expect } from "vitest";

import { ARRAY_FIELDS, badArrayField, badNullableArrayField } from "../../../server/config/config-body.js";
import { loadAppConfig, mergeConfigUpdate, sanitizeProviders } from "../../../server/config/app-config.js";

describe("badArrayField", () => {
  it("passes a body that omits every array field — a partial POST is the normal case", () => {
    expect(badArrayField({ soundFile: "/home/user/ding.wav" })).toBeNull();
  });

  it("passes arrays, including empty ones (clearing a list is a real edit)", () => {
    expect(badArrayField({ cwdPresets: [], prRepos: ["acme/web"], providers: [] })).toBeNull();
  });

  it.each(ARRAY_FIELDS)("rejects %s when it is present but not an array", (field) => {
    expect(badArrayField({ [field]: {} })).toBe(field);
  });

  it.each([{}, "openrouter", 42, true])("rejects the malformed providers value %j", (value) => {
    expect(badArrayField({ providers: value })).toBe("providers");
  });

  // Codex on PR #587: `providers` was the one array field missing from this guard.
  it("guards providers alongside the array fields that predate it", () => {
    expect(ARRAY_FIELDS).toContain("providers");
  });

  it("names only the first offender — the response reports one field", () => {
    expect(badArrayField({ prRepos: {}, providers: {} })).toBe("prRepos");
  });

  it("treats null as malformed for a non-nullable list", () => {
    expect(badArrayField({ providers: null })).toBe("providers");
  });
});

describe("badNullableArrayField", () => {
  it("allows null — that is how buttons/chips are unconfigured", () => {
    expect(badNullableArrayField({ buttons: null, chips: null })).toBeNull();
  });

  it("allows arrays", () => {
    expect(badNullableArrayField({ chips: ["git"] })).toBeNull();
  });

  it.each(["buttons", "chips"])("rejects %s when it is neither", (field) => {
    expect(badNullableArrayField({ [field]: "git" })).toBe(field);
  });
});

// Why the guard has to run BEFORE the merge, kept as an executable statement of the hazard
// rather than a comment: the merge reads "present" as "replace", and every sanitizer answers
// a non-array with an empty array. Without the guard, `{"providers": {}}` is not an error —
// it is a silent deletion of the user's backends.
describe("the deletion the guard prevents", () => {
  const PROVIDER = { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", tokenEnv: "OPENROUTER_API_KEY", models: [] };

  it("would wipe saved providers if a malformed body reached the merge", () => {
    const base = { ...loadAppConfig("/nonexistent/config.json"), providers: sanitizeProviders([PROVIDER]) };
    expect(base.providers).toHaveLength(1);
    expect(mergeConfigUpdate(base, { providers: {} }).providers).toEqual([]);
    expect(badArrayField({ providers: {} })).toBe("providers");
  });

  it("keeps saved providers when the body simply omits them", () => {
    const base = { ...loadAppConfig("/nonexistent/config.json"), providers: sanitizeProviders([PROVIDER]) };
    expect(mergeConfigUpdate(base, { soundFile: null }).providers).toHaveLength(1);
  });
});
