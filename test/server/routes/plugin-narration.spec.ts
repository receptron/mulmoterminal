import { describe, it, expect } from "vitest";

import { upstreamFailureMessage } from "../../../server/routes/plugin-narration.js";

const FALLBACK = "accounting request failed";

// What the agent reads when a plugin's own router refuses a tool call. The router's sentence
// names the actual problem, so it wins whenever there is one; the fallback exists for every
// shape that carries no sentence at all.
describe("upstreamFailureMessage", () => {
  it("prefers the router's own error text", () => {
    expect(upstreamFailureMessage(400, { error: "no ledger named 2026-07" }, FALLBACK)).toBe("no ledger named 2026-07");
  });

  it("keeps the router's text whatever else rides along with it", () => {
    expect(upstreamFailureMessage(400, { error: "bad action", action: "list", data: { rows: [] } }, FALLBACK)).toBe("bad action");
  });

  it("names the status when the body carries no error", () => {
    expect(upstreamFailureMessage(500, {}, FALLBACK)).toBe("accounting request failed (HTTP 500)");
  });

  it("uses the label it is given", () => {
    expect(upstreamFailureMessage(503, {}, "collection request failed")).toBe("collection request failed (HTTP 503)");
  });

  describe("bodies that carry no usable sentence fall back", () => {
    // `.json()` failing is caught upstream and becomes {}, but every one of these can arrive
    // from a router that answers with something else entirely.
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "Internal Server Error"],
      ["a number", 500],
      ["an array", ["nope"]],
      ["a non-string error", { error: 42 }],
      ["a nested error", { error: { message: "nope" } }],
      ["a differently named field", { message: "nope" }],
    ])("falls back for %s", (_label, body) => {
      expect(upstreamFailureMessage(500, body, FALLBACK)).toBe("accounting request failed (HTTP 500)");
    });
  });

  describe("status formatting", () => {
    it.each([400, 404, 418, 500, 503])("renders %i verbatim", (status) => {
      expect(upstreamFailureMessage(status, {}, FALLBACK)).toBe(`accounting request failed (HTTP ${status})`);
    });

    // fetch reports a status of 0 for some transport-level outcomes.
    it("renders a zero status rather than hiding it", () => {
      expect(upstreamFailureMessage(0, {}, FALLBACK)).toBe("accounting request failed (HTTP 0)");
    });
  });

  // Current behaviour, pinned rather than endorsed: an empty `error` is still a string, so it
  // wins over the fallback and the agent is told nothing at all. It takes a misbehaving
  // router to produce, and changing it is a behaviour change this refactor keeps out.
  it("passes an empty error string straight through", () => {
    expect(upstreamFailureMessage(400, { error: "" }, FALLBACK)).toBe("");
  });
});
