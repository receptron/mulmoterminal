// @vitest-environment node
import { describe, it, expect } from "vitest";
import { presenceOfStatError, shouldPruneMark, type TranscriptPresence } from "../../../../server/session/transcript/mark-prune.js";

const err = (code: unknown) => Object.assign(new Error("stat failed"), { code });

describe("presenceOfStatError", () => {
  it.each([["ENOENT"], ["ENOTDIR"]])("reads %s as a missing transcript", (code) => {
    expect(presenceOfStatError(err(code))).toBe("absent");
  });

  it.each([["EACCES"], ["EPERM"], ["EIO"], ["EMFILE"], ["ELOOP"], [""], [undefined], [42]])("reads code %j as unknown", (code) => {
    expect(presenceOfStatError(err(code))).toBe("unknown");
  });

  it.each([[null], [undefined], ["ENOENT"], [42], [{}]])("reads a non-error %j as unknown", (thrown) => {
    expect(presenceOfStatError(thrown)).toBe("unknown");
  });
});

describe("shouldPruneMark", () => {
  const ALL: TranscriptPresence[] = ["present", "absent", "unknown"];

  it("prunes only when every transcript the mark names is confirmed absent", () => {
    expect(shouldPruneMark("absent", null)).toBe(true);
    expect(shouldPruneMark("absent", "absent")).toBe(true);
  });

  it.each(ALL.flatMap((own) => [null, ...ALL].map((successor): [TranscriptPresence, TranscriptPresence | null] => [own, successor])))(
    "own %s, successor %s",
    (own, successor) => {
      const expected = own === "absent" && (successor === null || successor === "absent");
      expect(shouldPruneMark(own, successor)).toBe(expected);
    },
  );
});
