// @vitest-environment node
//
// THE WIRE CONTRACT, as documents rather than as types.
//
// One declaration (`test/fixtures/sharedAppGolden/app.json`) and the two
// `{tier}/config` documents it projects to, committed. This test regenerates
// them and diffs; mulmoserver holds a COPY of the same three files
// (`test/fixtures/sharedAppGolden/`) and feeds them to its own reader, asserting
// which capabilities come back for which address.
//
// Why documents and not a shared type. mulmoserver's reader takes `unknown`
// (`writeOf(value: unknown)`) and drops what it cannot parse, so nothing is
// type-checked at that boundary anyway — and a shared type would say nothing
// about the part that has actually broken twice: whether absence means "no
// opinion" or "refuse", and which tier answers which way. A document carries
// both, and a rename here fails over there.
//
// Regenerate with `UPDATE_GOLDEN=1 yarn vitest run test/server/backends/appViewGolden.spec.ts`,
// and then copy the changed files into mulmoserver. THAT COPY IS BY HAND, on
// purpose for now: see the open question in
// plans/refactor-shared-app-wire-contract.md about which CI tells the other
// repository that a golden moved. A changed golden in a diff is the signal.
//
// Design: plans/refactor-shared-app-wire-contract.md
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthoredAppZ } from "@mulmoclaude/core/collection/server";
import { projectAppViews } from "../../../server/backends/sharedApp/appViewProjection.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/sharedAppGolden");

/** Fixed, because a golden with a clock in it is a golden that fails tomorrow.
 *  `publishedAt` is part of the document the reader sees, so it is pinned here
 *  rather than stripped. */
const STAMP = { uid: "u-owner", email: "owner@salon.example", publishedAt: 1_700_000_000_000 };

const read = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf-8");

const projected = () => {
  // Through `AuthoredAppZ`, so a declaration publish would refuse cannot become
  // a golden that mulmoserver is then asked to agree with.
  const authored = AuthoredAppZ.parse(JSON.parse(read("app.json")));
  return projectAppViews(authored, STAMP);
};

describe("the golden {tier}/config documents", () => {
  for (const tier of ["member", "roster"] as const) {
    it(`matches what the projection writes for the ${tier} tier`, () => {
      const config = projected().find((entry) => entry.tier === tier)?.config;
      const serialized = `${JSON.stringify(config, null, 2)}\n`;
      if (process.env.UPDATE_GOLDEN) {
        writeFileSync(path.join(FIXTURES, `${tier}.config.json`), serialized);
      }
      // A string comparison rather than a deep-equal on parsed objects: KEY
      // ORDER is what mulmoserver's copy is diffed against, and a document that
      // reorders is a document somebody has to re-review.
      expect(serialized).toBe(read(`${tier}.config.json`));
    });
  }

  it("differs between the tiers in the three ways the reader depends on", () => {
    // The golden is only useful if it actually carries the distinctions. If a
    // future edit to app.json flattened these, the files above would still
    // match themselves and prove nothing.
    const member = JSON.parse(read("member.config.json")) as Record<string, unknown>;
    const roster = JSON.parse(read("roster.config.json")) as Record<string, unknown>;
    const memberWrite = (member.write as Record<string, unknown>[])[0];
    const rosterWrite = (roster.write as Record<string, unknown>[])[0];
    // 1. different transition tables for the same status field
    expect(memberWrite?.statusField).toBe(rosterWrite?.statusField);
    expect(memberWrite?.transitions).not.toEqual(rosterWrite?.transitions);
    // 2. the roster's answer to who may write, on the staff tier only
    expect(memberWrite).toHaveProperty("writers");
    expect(memberWrite).toHaveProperty("rowWriters");
    expect(rosterWrite).not.toHaveProperty("writers");
    expect(rosterWrite).not.toHaveProperty("rowWriters");
    // 3. a participant reads their OWN row where staff read the whole thing
    const memberViews = member.views as { collections: { cid: string; scope: string }[] }[];
    const rosterViews = roster.views as { collections: { cid: string; scope: string }[] }[];
    expect(memberViews[0]?.collections.find((entry) => entry.cid === "bookings")?.scope).toBe("all");
    expect(rosterViews[0]?.collections.find((entry) => entry.cid === "bookings")?.scope).toBe("own");
  });
});
