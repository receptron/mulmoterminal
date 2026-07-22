import { describe, it, expect } from "vitest";

import { parseDevTerminalSessionIds, devTerminalSessionLine } from "../../../server/session/dev-terminal-sessions.js";

const A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const C = "16fd2706-8baf-433b-82eb-8c7fada847da";
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const parse = (contents: string) => parseDevTerminalSessionIds(contents, isUuid);

describe("devTerminalSessionLine", () => {
  // Leading, not trailing: the legacy file ends WITHOUT a newline, so a trailing one would
  // weld the first appended id onto the end of the JSON array.
  it("starts the record on its own line", () => {
    expect(devTerminalSessionLine(A)).toBe(`\n${A}`);
  });

  it("round-trips through the parser", () => {
    expect(parse(devTerminalSessionLine(A) + devTerminalSessionLine(B))).toEqual([A, B]);
  });

  // The regression Codex caught: a trailing newline welds the first id onto the array.
  it("does not weld the first id onto a legacy array", () => {
    const welded = JSON.stringify([A]) + `${C}\n`;
    expect(parse(welded)).not.toContain(A);
    expect(parse(JSON.stringify([A]) + devTerminalSessionLine(C))).toEqual([A, C]);
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

    // What the file ACTUALLY looks like after the first append: the legacy array has no
    // trailing newline, so the appended record has to bring its own. Getting this wrong
    // loses every id that was already hidden — the whole point of the file.
    it("reads a legacy array appended to exactly as the writer writes it", () => {
      const onDisk = JSON.stringify([A, B]) + devTerminalSessionLine(C);
      expect(parse(onDisk)).toEqual([A, B, C]);
    });

    it("survives several appends onto a legacy file", () => {
      const onDisk = JSON.stringify([A]) + devTerminalSessionLine(B) + devTerminalSessionLine(C);
      expect(parse(onDisk)).toEqual([A, B, C]);
    });

    it("reads appends onto an empty file", () => {
      expect(parse(devTerminalSessionLine(A) + devTerminalSessionLine(B))).toEqual([A, B]);
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
