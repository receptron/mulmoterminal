import { describe, it, expect } from "vitest";

import { parseDevTerminalSessionIds, devTerminalSessionLine } from "../../../server/session/dev-terminal-sessions.js";

const A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const C = "16fd2706-8baf-433b-82eb-8c7fada847da";
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const parse = (contents: string) => parseDevTerminalSessionIds(contents, isUuid);

describe("devTerminalSessionLine", () => {
  // The newline is what makes concurrent appends land as separate records.
  it("ends the record so the next append starts its own line", () => {
    expect(devTerminalSessionLine(A)).toBe(`${A}\n`);
  });

  it("round-trips through the parser", () => {
    expect(parse(devTerminalSessionLine(A) + devTerminalSessionLine(B))).toEqual([A, B]);
  });
});

describe("parseDevTerminalSessionIds", () => {
  describe("the append log", () => {
    it("reads one id per line", () => {
      expect(parse(`${A}\n${B}\n`)).toEqual([A, B]);
    });

    it("reads a file with no trailing newline", () => {
      expect(parse(`${A}\n${B}`)).toEqual([A, B]);
    });

    it("reads an empty file as no ids", () => {
      expect(parse("")).toEqual([]);
      expect(parse("\n\n")).toEqual([]);
    });

    it("ignores surrounding whitespace on a line", () => {
      expect(parse(`  ${A}  \n\t${B}\n`)).toEqual([A, B]);
    });

    // Two instances can each append an id both of them marked.
    it("keeps one copy of an id appended twice", () => {
      expect(parse(`${A}\n${B}\n${A}\n`)).toEqual([A, B]);
    });

    it("keeps the order the ids were first appended in", () => {
      expect(parse(`${C}\n${A}\n${B}\n`)).toEqual([C, A, B]);
    });

    // The ids end up as filenames elsewhere, so anything that is not one is dropped.
    it("drops lines that are not a session id", () => {
      expect(parse(`${A}\n../../etc/passwd\nnot-a-uuid\n${B}\n`)).toEqual([A, B]);
    });
  });

  // An existing install has the old single-line JSON array. It keeps working, and simply
  // stops being rewritten.
  describe("the legacy JSON array", () => {
    it("reads the ids out of it", () => {
      expect(parse(JSON.stringify([A, B]))).toEqual([A, B]);
    });

    it("reads an empty array as no ids", () => {
      expect(parse("[]")).toEqual([]);
    });

    it("drops entries that are not a session id", () => {
      expect(parse(JSON.stringify([A, "nope", 42, null]))).toEqual([A]);
    });

    // What the file looks like after the first append to a legacy file: the array on the
    // first line, then plain ids. Both halves have to survive, or upgrading loses the ids
    // that were already hidden.
    it("reads a legacy array followed by appended ids", () => {
      expect(parse(`${JSON.stringify([A, B])}\n${C}\n`)).toEqual([A, B, C]);
    });

    it("does not lose the legacy ids when an appended one repeats them", () => {
      expect(parse(`${JSON.stringify([A])}\n${A}\n${B}\n`)).toEqual([A, B]);
    });

    it("ignores a truncated array rather than guessing at it", () => {
      expect(parse(`["${A}"\n${B}\n`)).toEqual([B]);
    });

    it("ignores a line that is an array of the wrong shape", () => {
      expect(parse(`{"ids":["${A}"]}\n${B}\n`)).toEqual([B]);
    });
  });
});
