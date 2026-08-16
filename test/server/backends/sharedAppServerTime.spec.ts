// @vitest-environment node
//
// What a page is handed for a SERVER-STAMPED field, and the ranking that depends on it.
//
// The bug this pins did not throw. A `stampField` is stored as a Firestore `Timestamp`, and a
// timestamp does not survive the trip to a sandboxed page: structured clone drops the class,
// JSON tags it, and `String()` of either is `"[object Object]"`. A page sorting by that field
// therefore compares every row equal, and a stable sort leaves them in the order they were read —
// document id order. The bundled first-come template ships exactly that sort, so its queue was
// ranked by id rather than by time, with nothing to see on screen.
//
// The normalisation itself is core's (`@mulmoclaude/core/collection`, applied at the read boundary
// that this repository reaches Firestore through). What is pinned HERE is the half this repository
// owns: that the value survives our own two serialisations unchanged, and that the comparison the
// bundled template ships is correct on it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decodeRecordTimes, serverTimeOf } from "@mulmoclaude/core/collection";

/** The instant observed in a real app, and one 987654ns later inside the SAME millisecond — the
 *  pair a millisecond-precision value collapses, and a burst is what a first-come app is for. */
const EARLY = serverTimeOf({ seconds: 1786835154, nanoseconds: 605000000 }) ?? "";
const SAME_MS = serverTimeOf({ seconds: 1786835154, nanoseconds: 605987654 }) ?? "";
const LATER = serverTimeOf({ seconds: 1786835160, nanoseconds: 0 }) ?? "";

const TEMPLATE = path.join(process.cwd(), "server/skills/mulmoterminal-shared-app/templates/gym.md");

/** The comparison the bundled template ships, verbatim. Kept as its own function so the assertions
 *  below are about THAT comparison and not about a tidier one written for the test. */
const rankedByTemplate = (rows: { id: string; createdAt?: unknown }[]): string[] =>
  rows
    .slice()
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
    .map((row) => row.id);

describe("a server-stamped field, as a page receives it", () => {
  it("is the comparison the gym template actually ships", () => {
    // A string check, deliberately: it fails when somebody rewrites the template's sort, which is
    // the moment to come back and re-read the rest of this file. It cannot execute the template.
    const template = readFileSync(TEMPLATE, "utf8");
    expect(template).toContain('.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))');
    // And the template must keep saying why a plain string compare is right, or the next author
    // "fixes" it into a Date parse and loses the sub-millisecond order.
    expect(template).toContain("new Date() に通しては");
  });

  it("ranks a burst by time, not by the order it was read in", () => {
    // Read order is document id order (`orderBy("__name__")`), which is what a stable sort falls
    // back to — so the rows are given here in the WRONG order on purpose.
    const rows = [
      { id: "a-latest", createdAt: LATER },
      { id: "b-earliest", createdAt: EARLY },
      { id: "c-same-ms", createdAt: SAME_MS },
    ];
    expect(rankedByTemplate(rows)).toEqual(["b-earliest", "c-same-ms", "a-latest"]);
  });

  it("is what the bug looked like: an undecoded stamp ranks by document id", () => {
    // The three shapes a `Timestamp` arrives in if the read boundary is bypassed. All of them
    // stringify the same way, so every row compares equal and the input order survives.
    const cloned = structuredClone({ seconds: 1786835154, nanoseconds: 605000000 });
    const tagged = { type: "firestore/timestamp/1.0", seconds: 1786835154, nanoseconds: 605987654 };
    expect(String(cloned)).toBe("[object Object]");
    expect(String(tagged)).toBe("[object Object]");
    const rows = [
      { id: "a-latest", createdAt: { seconds: 1786835160, nanoseconds: 0 } },
      { id: "b-earliest", createdAt: cloned },
      { id: "c-same-ms", createdAt: tagged },
    ];
    // Input order, with the LATEST booking first. Nothing errors; the ranks look plausible.
    expect(rankedByTemplate(rows)).toEqual(["a-latest", "b-earliest", "c-same-ms"]);
  });

  it("survives both serialisations this repository puts a page's records through", () => {
    // The pane's preview crosses HTTP as JSON; the headless run is handed its datasets as a
    // `JSON.stringify` argument to `page.evaluate`. Neither may re-shape the value — a page that
    // sorted correctly in one and not the other is the divergence the preview exists to prevent.
    const row = { id: "b1", createdAt: SAME_MS };
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
    expect(JSON.parse(JSON.stringify([row]))[0].createdAt).toBe(SAME_MS);
    // And structured clone, which is how the OTHER host hands a page its records.
    expect(structuredClone(row).createdAt).toBe(SAME_MS);
  });

  it("is decoded from every shape a stored stamp arrives in", () => {
    // core owns this, and it is asserted here because this repository depends on it happening
    // before a record reaches a projection: a fake `FirestoreDocs` in another spec bypasses the
    // real adapter, so nothing else in this repository would notice it stopping.
    const parts = { seconds: 1786835154, nanoseconds: 605000000 };
    expect(decodeRecordTimes({ id: "b1", createdAt: parts })).toEqual({ id: "b1", createdAt: EARLY });
    expect(decodeRecordTimes({ id: "b1", createdAt: structuredClone(parts) })).toEqual({ id: "b1", createdAt: EARLY });
    expect(decodeRecordTimes({ id: "b1", createdAt: { type: "firestore/timestamp/1.0", ...parts } })).toEqual({ id: "b1", createdAt: EARLY });
    // A civil datetime an author typed is left exactly as it is.
    expect(decodeRecordTimes({ id: "b1", startsAt: "2026-08-15T10:00" })).toEqual({ id: "b1", startsAt: "2026-08-15T10:00" });
  });
});
