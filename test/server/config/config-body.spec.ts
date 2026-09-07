// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  ARRAY_FIELDS,
  NULLABLE_ARRAY_FIELDS,
  OBJECT_FIELDS,
  badArrayField,
  badNullableArrayField,
  badObjectField,
} from "../../../server/config/config-body.js";
import { emptyConfig } from "../../../server/config/app-config.js";
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

  // The `it.each` above iterates ARRAY_FIELDS itself, so it proves each member IS guarded and
  // nothing about which members exist — drop one and it silently runs one case fewer while that
  // field becomes wipeable. Pinning the whole list is what makes a removal (or a new field the
  // author forgot to add) fail here.
  //
  // Written as the full list rather than one assertion per field because the gap has now
  // appeared three times: `providers` (#587), `quickCommands` (#830), `pushKinds` (#850) — each
  // caught by review rather than by a test. Adding a field means updating this line, which is
  // the point: it is a decision, not an oversight.
  it("guards exactly these fields — a removal here is a field that can be silently wiped", () => {
    expect([...ARRAY_FIELDS]).toEqual([
      "cwdPresets",
      "prRepos",
      "gitlabHosts",
      "launchers",
      "customAgents",
      "quickCommands",
      "pushKinds",
      "soundKinds",
      "userMcpServers",
      "providers",
      "themes",
      "toolbarPins",
    ]);
  });

  // ...and `themes` (#996) made four, also caught by review. The list above cannot catch an
  // ADDITION — it still matches the unchanged ARRAY_FIELDS while the new field goes unguarded —
  // so this one derives the answer from the config itself: every array-valued field of a default
  // AppConfig has to be guarded somewhere. A new one fails here without anyone remembering to.
  it("guards every array field the config actually has", () => {
    const guarded = new Set<string>([...ARRAY_FIELDS, ...NULLABLE_ARRAY_FIELDS]);
    const arrayFields = Object.entries(emptyConfig())
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key);
    expect(arrayFields.filter((field) => !guarded.has(field))).toEqual([]);
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

describe("badObjectField", () => {
  it("passes a body that omits it — a partial POST is the normal case", () => {
    expect(badObjectField({ soundKinds: ["finished"] })).toBeNull();
  });

  it("passes an object, including an empty one (clearing every per-kind sound is a real edit)", () => {
    expect(badObjectField({ sounds: {} })).toBeNull();
    expect(badObjectField({ sounds: { finished: "preset:coin" } })).toBeNull();
  });

  // The trap this guards: the sanitizer answers a non-object with `{}`, so without the check a
  // malformed body would be applied as "the user cleared every per-kind sound".
  it.each(OBJECT_FIELDS)("rejects %s when it is present but not an object", (field) => {
    for (const bad of [[], "preset:coin", 42, true, null]) {
      expect(badObjectField({ [field]: bad })).toBe(field);
    }
  });
});
