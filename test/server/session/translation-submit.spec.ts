import { describe, it, expect, vi } from "vitest";

import { translationSubmitOutcome } from "../../../server/session/translation-submit.js";

const SESSION = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const handOffThat = (result: boolean) => vi.fn().mockReturnValue(result);

describe("translationSubmitOutcome", () => {
  it("accepts a worker's answer for a session that is waiting for one", () => {
    const handOff = handOffThat(true);
    expect(translationSubmitOutcome({ sessionId: SESSION, translations: ["こんにちは"] }, isUuid, handOff)).toEqual({ status: 200, body: { ok: true } });
    expect(handOff).toHaveBeenCalledWith(SESSION, ["こんにちは"]);
  });

  // Already settled, timed out, or never a worker at all.
  it("reports 404 when nothing is waiting on that id", () => {
    expect(translationSubmitOutcome({ sessionId: SESSION, translations: [] }, isUuid, handOffThat(false))).toEqual({
      status: 404,
      body: { error: "no pending translation for this session" },
    });
  });

  describe("an id that is not the known shape is refused", () => {
    // The id reaches a Map key and a pub/sub channel name, so the shape check comes first.
    it.each([
      ["a non-uuid string", { sessionId: "../../etc/passwd", translations: [] }],
      ["an empty string", { sessionId: "", translations: [] }],
      ["a number", { sessionId: 42, translations: [] }],
      ["null", { sessionId: null, translations: [] }],
      ["a missing field", { translations: [] }],
      ["an object", { sessionId: { id: SESSION }, translations: [] }],
    ])("refuses %s", (_label, body) => {
      expect(translationSubmitOutcome(body, isUuid, handOffThat(true))).toEqual({ status: 400, body: { error: "invalid sessionId" } });
    });

    // The hand-off mutates the pending map, so a bad id must not reach it at all.
    it("does not hand anything off", () => {
      const handOff = handOffThat(true);
      translationSubmitOutcome({ sessionId: "nope", translations: [] }, isUuid, handOff);
      expect(handOff).not.toHaveBeenCalled();
    });
  });

  describe("a body that is not an object at all is refused", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "sessionId=x"],
      ["a number", 7],
      ["an empty object", {}],
    ])("refuses %s", (_label, body) => {
      expect(translationSubmitOutcome(body, isUuid, handOffThat(true))).toEqual({ status: 400, body: { error: "invalid sessionId" } });
    });
  });

  // Whatever arrived is handed over as-is: translateViaHiddenChat is what decides whether the
  // payload is usable, and it answers the waiting request either way.
  describe("the translations payload is passed through untouched", () => {
    it.each([
      ["an array", ["a", "b"]],
      ["an empty array", []],
      ["undefined", undefined],
      ["a string", "not an array"],
      ["null", null],
      ["an object", { 0: "a" }],
    ])("passes %s straight to the hand-off", (_label, translations) => {
      const handOff = handOffThat(true);
      translationSubmitOutcome({ sessionId: SESSION, translations }, isUuid, handOff);
      expect(handOff).toHaveBeenCalledWith(SESSION, translations);
    });
  });

  it("asks the validator it is given, rather than assuming a shape", () => {
    const isValid = vi.fn().mockReturnValue(false);
    expect(translationSubmitOutcome({ sessionId: SESSION, translations: [] }, isValid, handOffThat(true)).status).toBe(400);
    expect(isValid).toHaveBeenCalledWith(SESSION);
  });
});
