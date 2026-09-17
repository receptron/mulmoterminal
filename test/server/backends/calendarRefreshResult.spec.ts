// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { CalendarCollectionSyncResult, ManualCalendarSyncOutcome } from "@mulmoclaude/core/google";

import { CALENDAR_NOT_DECLARED_ERROR, CALENDAR_NOT_LINKED_ERROR, calendarRefreshResult } from "../../../server/backends/calendarRefreshResult.js";
import { PUSH_NOT_LINKED_ERROR } from "../../../server/backends/calendarPushResult.js";

const syncResult = (over: Partial<CalendarCollectionSyncResult> & { slug: string }): CalendarCollectionSyncResult => ({
  written: 0,
  removed: 0,
  unwritable: [],
  withheld: [],
  errors: [],
  ...over,
});

describe("calendarRefreshResult", () => {
  it("reports the requested collection's own counts", () => {
    const outcome: ManualCalendarSyncOutcome = { kind: "synced", results: [syncResult({ slug: "meetings", written: 4, removed: 1 })] };
    expect(calendarRefreshResult("meetings", outcome)).toEqual({ refreshed: true, written: 4, removed: 1, errors: [] });
  });

  // The engine syncs the whole calendar GROUP because the sync token is keyed by calendar, not
  // by collection — consuming a window for one would leave its siblings reading a spent one. The
  // user asked about one slug, so the siblings' counts must not be added to the answer.
  it("leaves the rest of the synced group out of the counts", () => {
    const outcome: ManualCalendarSyncOutcome = {
      kind: "synced",
      results: [syncResult({ slug: "meetings", written: 4, removed: 1 }), syncResult({ slug: "personal", written: 90, removed: 7, errors: ["nope"] })],
    };
    expect(calendarRefreshResult("meetings", outcome)).toEqual({ refreshed: true, written: 4, removed: 1, errors: [] });
  });

  // A slug that synced nothing of its own still answers, rather than reporting the group's work
  // as if it were this collection's.
  it("answers zero when the requested slug is not among the results", () => {
    const outcome: ManualCalendarSyncOutcome = { kind: "synced", results: [syncResult({ slug: "personal", written: 90 })] };
    expect(calendarRefreshResult("meetings", outcome)).toEqual({ refreshed: true, written: 0, removed: 0, errors: [] });
  });

  it("sums a slug that appears once per calendar in the group", () => {
    const outcome: ManualCalendarSyncOutcome = {
      kind: "synced",
      results: [syncResult({ slug: "meetings", written: 2, removed: 1 }), syncResult({ slug: "meetings", written: 3, removed: 4 })],
    };
    expect(calendarRefreshResult("meetings", outcome)).toMatchObject({ written: 5, removed: 5 });
  });

  // `unwritable` never retries, so the hourly task would drop it silently. The person who
  // clicked is the only one who can act on it, which is why it rides the manual answer.
  it("reports unwritable events alongside retryable errors", () => {
    const outcome: ManualCalendarSyncOutcome = {
      kind: "synced",
      results: [syncResult({ slug: "meetings", errors: ["rate limited"], unwritable: ["evt-1: id rejected"] })],
    };
    expect(calendarRefreshResult("meetings", outcome).errors).toEqual(["rate limited", "evt-1: id rejected"]);
  });

  // `withheld` is a local edit deliberately kept, which the next PUSH reports as a conflict. It
  // is not a failure of this sync and must not turn the button red.
  it("does not report withheld records as errors", () => {
    const outcome: ManualCalendarSyncOutcome = { kind: "synced", results: [syncResult({ slug: "meetings", written: 1, withheld: ["evt-9"] })] };
    expect(calendarRefreshResult("meetings", outcome).errors).toEqual([]);
  });

  // Counts alone would render "0 written", which reads as an empty calendar when the real
  // answer is a setup gap the user can close.
  describe("a sync that could not run says why", () => {
    it.each<[string, ManualCalendarSyncOutcome, string]>([
      ["no Google account", { kind: "not-linked" }, CALENDAR_NOT_LINKED_ERROR],
      ["no calendar declared", { kind: "not-a-calendar" }, CALENDAR_NOT_DECLARED_ERROR],
    ])("%s", (_label, outcome, expected) => {
      expect(calendarRefreshResult("meetings", outcome)).toEqual({ refreshed: true, written: 0, errors: [expected] });
    });
  });

  // Both directions hit the same wall for the same reason, so a user who presses one button and
  // then the other must not be told two different things. The two constants are separate on
  // purpose (MulmoClaude keeps them apart too); this is what stops them drifting.
  it("explains an unlinked account exactly as the push does", () => {
    expect(CALENDAR_NOT_LINKED_ERROR).toBe(PUSH_NOT_LINKED_ERROR);
  });
});
