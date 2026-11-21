// @vitest-environment node
import { describe, it, expect } from "vitest";
import { applyRelayMark, relayMarkLine, relayMarkMapKey, relayMarkRecord, RELAY_DEST_MAX_CHARS } from "../../../../server/session/transcript/relay-marks.js";

const MARK = "a".repeat(64);
const ID = "11111111-2222-3333-4444-555555555555";
const valid = { agent: "codex", conversation: ID, dest: "/w/dest", mark: MARK };
const isValidId = (id: string) => id === ID;

describe("relayMarkRecord", () => {
  it("reads back what relayMarkLine wrote", () => {
    const parsed: unknown = JSON.parse(relayMarkLine({ agent: "codex", conversation: ID, dest: "/w/dest", mark: MARK }, 1));
    expect(typeof parsed === "object" && parsed !== null ? relayMarkRecord({ ...parsed }, isValidId) : null).toEqual(valid);
  });

  it.each([
    ["an unknown agent", { ...valid, agent: "shell" }],
    ["a missing agent", { ...valid, agent: undefined }],
    ["an invalid conversation id", { ...valid, conversation: "../x" }],
    ["an empty destination", { ...valid, dest: "" }],
    ["an over-long destination", { ...valid, dest: "/".repeat(RELAY_DEST_MAX_CHARS + 1) }],
    ["a malformed mark", { ...valid, mark: "xyz" }],
  ])("refuses %s", (_label, parsed) => {
    expect(relayMarkRecord(parsed, isValidId)).toBeNull();
  });
});

describe("applyRelayMark", () => {
  it("keeps the last mark per (agent, conversation, destination)", () => {
    const marks = new Map<string, string>();
    applyRelayMark(marks, { agent: "codex", conversation: ID, dest: "/a", mark: MARK });
    applyRelayMark(marks, { agent: "codex", conversation: ID, dest: "/a", mark: "b".repeat(64) });
    applyRelayMark(marks, { agent: "codex", conversation: ID, dest: "/b", mark: MARK });
    applyRelayMark(marks, { agent: "claude", conversation: ID, dest: "/a", mark: MARK });
    expect(marks.get(relayMarkMapKey({ agent: "codex", conversation: ID, dest: "/a" }))).toBe("b".repeat(64));
    expect(marks.size).toBe(3);
  });
});
