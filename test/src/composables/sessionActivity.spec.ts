import { describe, it, expect } from "vitest";
import { parseSessionActivityPayload } from "../../../src/composables/../../src/composables/sessionActivity";

describe("parseSessionActivityPayload", () => {
  it("parses a normal activity push", () => {
    expect(parseSessionActivityPayload({ id: "a", working: true, waiting: false, event: "UserPromptSubmit" })).toEqual({
      id: "a",
      activity: { working: true, waiting: false, event: "UserPromptSubmit" },
    });
  });

  it("parses a blocked (Notification) push", () => {
    expect(parseSessionActivityPayload({ id: "a", working: false, waiting: true, event: "Notification" })).toEqual({
      id: "a",
      activity: { working: false, waiting: true, event: "Notification" },
    });
  });

  it("treats a closed push as a removal", () => {
    expect(parseSessionActivityPayload({ id: "a", working: false, event: "closed" })).toEqual({ id: "a", closed: true });
  });

  it("defaults missing flags to false / null", () => {
    expect(parseSessionActivityPayload({ id: "a" })).toEqual({ id: "a", activity: { working: false, waiting: false, event: null } });
  });

  it("rejects payloads without a string id", () => {
    expect(parseSessionActivityPayload({ working: true })).toBeNull();
    expect(parseSessionActivityPayload(null)).toBeNull();
    expect(parseSessionActivityPayload("nope")).toBeNull();
    expect(parseSessionActivityPayload({ id: 42 })).toBeNull();
  });
});
