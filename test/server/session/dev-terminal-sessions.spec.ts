import { describe, it, expect } from "vitest";

import { parseDevTerminalSessionIds, mergeDevTerminalSessionIds } from "../../../server/session/dev-terminal-sessions.js";

const A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const C = "16fd2706-8baf-433b-82eb-8c7fada847da";
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

describe("parseDevTerminalSessionIds", () => {
  it("keeps the ids from a well-formed file", () => {
    expect(parseDevTerminalSessionIds([A, B], isUuid)).toEqual([A, B]);
  });

  it("reads an empty file as no ids", () => {
    expect(parseDevTerminalSessionIds([], isUuid)).toEqual([]);
  });

  // The ids end up as filenames elsewhere, so anything that is not one is dropped rather
  // than carried along.
  it("drops entries that are not a session id", () => {
    expect(parseDevTerminalSessionIds([A, "../../etc/passwd", "", B], isUuid)).toEqual([A, B]);
  });

  it("drops entries that are not strings", () => {
    expect(parseDevTerminalSessionIds([A, 42, null, { id: B }, [B]], isUuid)).toEqual([A]);
  });

  describe("a file that is not a list of ids", () => {
    it.each([
      ["an object", { ids: [A] }],
      ["a string", A],
      ["a number", 7],
      ["null", null],
      ["undefined", undefined],
    ])("reads %s as no ids", (_label, raw) => {
      expect(parseDevTerminalSessionIds(raw, isUuid)).toEqual([]);
    });
  });
});

// Two servers share ~/.mulmoterminal — launching twice is the ordinary way to get there,
// since the launcher falls back to another port when the default is busy. Writing only our
// own set drops what the peer marked, and a dropped id means that grid cell's transcript
// reappears in the chat sidebar.
describe("mergeDevTerminalSessionIds", () => {
  it("keeps ids only the other instance knows about", () => {
    expect(mergeDevTerminalSessionIds([A], [B])).toEqual([A, B].sort());
  });

  it("keeps our own when the file is empty", () => {
    expect(mergeDevTerminalSessionIds([], [A, B])).toEqual([A, B].sort());
  });

  it("keeps the file's when we know nothing", () => {
    expect(mergeDevTerminalSessionIds([A, B], [])).toEqual([A, B].sort());
  });

  it("does not duplicate an id both know", () => {
    expect(mergeDevTerminalSessionIds([A, B], [B, C])).toEqual([A, B, C].sort());
  });

  it("returns nothing when neither has any", () => {
    expect(mergeDevTerminalSessionIds([], [])).toEqual([]);
  });

  it("accepts a Set, which is what the registry holds", () => {
    expect(mergeDevTerminalSessionIds([A], new Set([B, A]))).toEqual([A, B].sort());
  });

  // A stable order keeps the file from churning between writes that changed nothing.
  it("orders the result the same way whatever order it was given", () => {
    expect(mergeDevTerminalSessionIds([C, A], [B])).toEqual(mergeDevTerminalSessionIds([B, C], [A]));
  });

  // The scenario in one test: A boots and marks x, B boots and marks y, and B writes last.
  it("does not let the last writer drop the other's ids", () => {
    const bootedFrom = [A];
    const serverAWrites = mergeDevTerminalSessionIds(bootedFrom, new Set([A, B]));
    const serverBWrites = mergeDevTerminalSessionIds(serverAWrites, new Set([A, C]));
    expect(serverBWrites).toEqual([A, B, C].sort());
  });
});
