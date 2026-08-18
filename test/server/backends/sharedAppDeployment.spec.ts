// @vitest-environment node
import { describe, it, expect } from "vitest";

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { capabilityNotes, capabilityRefusal, REQUIRED_RULES_VERSION, sharedappRuntime } from "../../../server/backends/sharedApp/deployment.js";

// WHICH READINGS STOP A PUBLISH. The rules are deployed by hand with no CI in the path, so this is
// the only place a publisher can learn that the deployment it writes to is behind what it writes —
// and it is also the place where being over-strict costs the most: every deployment predates the
// record until somebody writes it, so refusing on "no record" would brick publish everywhere on
// the day it ships. Only a deployment that ANSWERED, and answered that it is behind, is refused.
describe("the deployment capability gate", () => {
  it("refuses a deployment whose recorded rules are behind what publish writes", () => {
    const problems = capabilityRefusal({ state: "known", capabilities: { rulesVersion: REQUIRED_RULES_VERSION - 1 } });
    expect(problems.length).toBeGreaterThan(0);
    // The number it found and the number it needs — a refusal naming neither is one nobody can act on.
    expect(problems[0]).toContain(String(REQUIRED_RULES_VERSION - 1));
    expect(problems[0]).toContain(String(REQUIRED_RULES_VERSION));
    // And where the fix is. The rules are in another repository and are deployed by hand; a
    // refusal that does not say so sends the reader looking through this one.
    expect(problems.join(" ")).toContain("firestore.rules");
    expect(problems.join(" ")).toContain("Nothing was written");
  });

  it("accepts a deployment at, or ahead of, what publish needs", () => {
    expect(capabilityRefusal({ state: "known", capabilities: { rulesVersion: REQUIRED_RULES_VERSION } })).toEqual([]);
    expect(capabilityRefusal({ state: "known", capabilities: { rulesVersion: REQUIRED_RULES_VERSION + 5 } })).toEqual([]);
  });

  // The two readings that are NOT an answer about capability. Neither may refuse — a host-side
  // gate is a diagnostic, not an authority (principle 2) — and neither may go quiet either.
  it("does not refuse when the deployment records nothing, and says that it recorded nothing", () => {
    expect(capabilityRefusal({ state: "absent" })).toEqual([]);
    const notes = capabilityNotes({ state: "absent" }, "0.10.0");
    expect(notes.join(" ")).toContain("deployment/capabilities");
  });

  it("does not refuse when the record could not be read, and keeps the reason", () => {
    expect(capabilityRefusal({ state: "unreadable", reason: "offline" })).toEqual([]);
    const notes = capabilityNotes({ state: "unreadable", reason: "offline" }, "0.10.0");
    expect(notes.join(" ")).toContain("offline");
    // "We could not ask" is not "it is behind", and saying the second would be a lie the author acts on.
    expect(notes.join(" ")).toContain("not evidence");
  });

  // The runtime is REPORTED, never refused on: the compiler does not yet stamp a projection
  // version (item 7-2 in plans/fix-shared-app-codex-review.md, which needs a sharedapp release),
  // so what can be said is which two versions are in play — not whether they are compatible.
  it("names both runtime versions when they differ, and stays silent when they agree", () => {
    const differ = capabilityNotes({ state: "known", capabilities: { rulesVersion: REQUIRED_RULES_VERSION, runtime: "0.8.0" } }, "0.10.0");
    expect(differ.join(" ")).toContain("0.8.0");
    expect(differ.join(" ")).toContain("0.10.0");
    expect(capabilityRefusal({ state: "known", capabilities: { rulesVersion: REQUIRED_RULES_VERSION, runtime: "0.8.0" } })).toEqual([]);
    expect(capabilityNotes({ state: "known", capabilities: { rulesVersion: REQUIRED_RULES_VERSION, runtime: "0.10.0" } }, "0.10.0")).toEqual([]);
  });
});

// WHICH VERSION COMPILED THE PROJECTION. Its own test because the failure is silent in both
// directions: reading it wrong costs nothing at the call site (the value is only reported) and
// then makes `capabilityNotes` announce a runtime mismatch on every deployment that records one.
// The package's `exports` map is what breaks this — it lists `.` and `./view`, so the manifest is
// not requirable by name, and a future rearrangement of the package can break it again.
describe("the sharedapp runtime version", () => {
  it("is the version actually installed, not `unknown`", () => {
    // Read the way a person would check by hand — straight off the installed file, not through the
    // package's `exports`, which is the thing under test.
    const require = createRequire(import.meta.url);
    const manifest = join(dirname(require.resolve("@receptron/sharedapp")), "..", "package.json");
    const installed = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
    const version = installed.version;
    expect(version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(sharedappRuntime()).toBe(version);
  });
});
