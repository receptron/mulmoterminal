import { describe, it, expect } from "vitest";

import { planToolResultUpdate } from "../../../server/routes/toolResultPlan.js";

// A well-formed session id; the plan keeps it to the UUID shape because it becomes a
// channel name and a filename.
const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

const validBody = (extra: Record<string, unknown> = {}) => ({
  sessionId: SESSION_ID,
  toolName: "accounting",
  uuid: "call-1",
  ...extra,
});

// The plan is the decision the route used to inline: what to store, and whether to publish.
// The route now only performs the store write and the publish it hands back.
describe("planToolResultUpdate", () => {
  it("accepts a well-formed body and publishes by default", () => {
    const plan = planToolResultUpdate(validBody({ result: { rows: [] } }));
    expect(plan).toEqual({
      ok: true,
      stored: { toolName: "accounting", uuid: "call-1", result: { rows: [] } },
      publish: true,
      sessionId: SESSION_ID,
      toolName: "accounting",
    });
  });

  it("strips the routing fields from what it stores", () => {
    const plan = planToolResultUpdate(validBody({ persistOnly: false }));
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.stored).not.toHaveProperty("sessionId");
    expect(plan.stored).not.toHaveProperty("persistOnly");
    // Everything else the panel renders is kept.
    expect(plan.stored).toMatchObject({ toolName: "accounting", uuid: "call-1" });
  });

  it("suppresses the publish when the panel persists its own state (persistOnly === true)", () => {
    const plan = planToolResultUpdate(validBody({ persistOnly: true }));
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.publish).toBe(false);
    expect(plan.stored).not.toHaveProperty("persistOnly");
  });

  // Only the strict boolean `true` suppresses the echo; anything else is a broker result
  // that must render live. Pinned so a "truthy" rewrite (`!persistOnly`) is caught.
  describe("a truthy-but-not-true persistOnly still publishes", () => {
    it.each([
      ['the string "true"', "true"],
      ["the number 1", 1],
      ["an object", {}],
      ["an array", []],
    ])("keeps publish=true for %s", (_label, persistOnly) => {
      const plan = planToolResultUpdate(validBody({ persistOnly }));
      if (!plan.ok) throw new Error("expected ok");
      expect(plan.publish).toBe(true);
    });
  });

  describe("rejects a bad sessionId before anything else", () => {
    it.each([
      ["missing", undefined],
      ["empty string", ""],
      ["a non-UUID string", "not-a-uuid"],
      ["a uuid with trailing junk", `${SESSION_ID}x`],
      ["a number", 123],
      ["a boolean", true],
      ["an object", {}],
      // Coerces to the UUID string, but a non-string id is still rejected.
      ["a single-element array of the uuid", [SESSION_ID]],
    ])("returns invalid sessionId for %s", (_label, sessionId) => {
      expect(planToolResultUpdate({ sessionId, toolName: "accounting", uuid: "call-1" })).toEqual({
        ok: false,
        error: "invalid sessionId",
      });
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "nope"],
      ["a number", 5],
      ["an array", []],
    ])("returns invalid sessionId for a non-record body: %s", (_label, body) => {
      expect(planToolResultUpdate(body)).toEqual({ ok: false, error: "invalid sessionId" });
    });
  });

  describe("rejects a bad toolName once the sessionId is valid", () => {
    it.each([
      ["missing", undefined],
      ["empty string", ""],
      ["a number", 7],
      ["null", null],
    ])("returns invalid toolName for %s", (_label, toolName) => {
      expect(planToolResultUpdate({ sessionId: SESSION_ID, toolName, uuid: "call-1" })).toEqual({
        ok: false,
        error: "invalid toolName",
      });
    });
  });

  describe("rejects a bad uuid last", () => {
    it.each([
      ["missing", undefined],
      ["empty string", ""],
      ["a number", 7],
      ["an object", {}],
    ])("returns invalid uuid for %s", (_label, uuid) => {
      expect(planToolResultUpdate({ sessionId: SESSION_ID, toolName: "accounting", uuid })).toEqual({
        ok: false,
        error: "invalid uuid",
      });
    });
  });

  // Validation order: a body wrong in two ways reports the first failure the route would
  // have hit, so the messages match the original handler exactly.
  it("reports sessionId before toolName", () => {
    expect(planToolResultUpdate({ toolName: 1, uuid: 2 })).toEqual({ ok: false, error: "invalid sessionId" });
  });

  it("reports toolName before uuid", () => {
    expect(planToolResultUpdate({ sessionId: SESSION_ID, uuid: 2 })).toEqual({ ok: false, error: "invalid toolName" });
  });
});
