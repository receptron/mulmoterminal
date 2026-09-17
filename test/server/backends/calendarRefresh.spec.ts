// @vitest-environment node
// The calendar arm of the collection refresh route. The engine is injected, so the three
// outcomes are exercised without a workspace on disk or a live Google grant.
import { describe, it, expect, vi } from "vitest";
import type { ManualCalendarSyncOutcome } from "@mulmoclaude/core/google";

import { syncCalendarCollection, type CalendarSync } from "../../../server/backends/calendarRefresh.js";
import { CALENDAR_NOT_LINKED_ERROR } from "../../../server/backends/calendarRefreshResult.js";

const synced = (slug: string, written: number): ManualCalendarSyncOutcome => ({
  kind: "synced",
  results: [{ slug, written, removed: 0, unwritable: [], withheld: [], errors: [] }],
});

describe("syncCalendarCollection", () => {
  it("asks the engine for the requested slug against the root it was given", async () => {
    const sync = vi.fn<CalendarSync>(async () => synced("meetings", 5));
    expect(await syncCalendarCollection("meetings", "/projects/alpha", sync)).toEqual({ refreshed: true, written: 5, removed: 0, errors: [] });
    // The pair matters more than either half: a slug looked up in one root and synced against
    // another is a request that silently answers for a different project's collection.
    expect(sync).toHaveBeenCalledWith("meetings", "/projects/alpha");
  });

  // A refusal is a 200 with the reason, because the view renders `errors` beside the button
  // that was pressed. Reporting "0 written" instead would read as an empty calendar.
  it("reports a setup gap as an error rather than an empty sync", async () => {
    const sync = vi.fn<CalendarSync>(async () => ({ kind: "not-linked" }));
    expect(await syncCalendarCollection("meetings", "/ws", sync)).toEqual({ refreshed: true, written: 0, errors: [CALENDAR_NOT_LINKED_ERROR] });
  });

  // The engine catches its own failures into an outcome, so a throw means something below it
  // broke. It belongs to the route's 500, not swallowed into a green-looking empty sync.
  it("lets an engine throw escape to the route", async () => {
    const sync = vi.fn<CalendarSync>(async () => {
      throw new Error("token store unreadable");
    });
    await expect(syncCalendarCollection("meetings", "/ws", sync)).rejects.toThrow("token store unreadable");
  });
});
