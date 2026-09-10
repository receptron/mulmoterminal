// @vitest-environment node
// What a standalone MulmoTerminal registers with the scheduler.
//
// Pinned by id, not by count: the calendar sync was absent for months with nothing to notice
// (#1191), because index.ts built the list inline and no spec could read it.
import { describe, it, expect } from "vitest";
import path from "node:path";

import { buildSystemTasks } from "../../../server/backends/system-tasks.js";

// Through `path.resolve`, never as POSIX literals: the id carries the CANONICAL root, and
// canonicalising with the platform's own path drive-qualifies on Windows (`D:\ws`). A literal
// `/ws` expectation therefore passes everywhere except the daily Windows job — which is where
// this spec first went red. See docs/windows-gotchas.md, "Tests that handle paths".
const WS = path.resolve("/ws");
const MAG2 = path.resolve("/srv/mag2");
const feedId = (root: string) => `system:feed-refresh:${root}`;

const WORKLOG_OFF = { enabled: false, intervalHours: 6 };
// What every existing config resolves to: both on. The switches are the #2015 addition, and the
// cases that turn one off say so explicitly.
const BOTH_ON = { feedRefresh: true, calendarSync: true };
const buildWithRoots = (feedRoots: string[]) => buildSystemTasks({ workspaceRoot: WS, feedRoots, worklog: WORKLOG_OFF, enabled: BOTH_ON, spawnChat: () => "" });
const feedIds = (tasks: ReturnType<typeof buildSystemTasks>) => tasks.map((task) => task.id).filter((id) => id.startsWith("system:feed-refresh"));
const build = (worklog = WORKLOG_OFF, enabled = BOTH_ON) =>
  buildSystemTasks({ workspaceRoot: WS, worklog, enabled, spawnChat: () => "11111111-1111-1111-1111-111111111111" });

describe("buildSystemTasks", () => {
  // #2015: a USER task in tasks.json has always honoured `enabled: false`; the two built-in ones
  // had no equivalent, which is the asymmetry the switches close.
  describe("the per-task switches", () => {
    it("drops every feed refresh when feedRefresh is off, leaving the calendar alone", () => {
      const ids = buildSystemTasks({
        workspaceRoot: WS,
        feedRoots: [MAG2],
        worklog: WORKLOG_OFF,
        enabled: { feedRefresh: false, calendarSync: true },
        spawnChat: () => "",
      }).map((task) => task.id);
      expect(ids.filter((id) => id.startsWith("system:feed-refresh"))).toEqual([]);
      expect(ids).toContain("system:google-calendar-sync");
    });

    it("drops the calendar sync when calendarSync is off, leaving the feed refreshes alone", () => {
      const ids = build(WORKLOG_OFF, { feedRefresh: true, calendarSync: false }).map((task) => task.id);
      expect(ids).not.toContain("system:google-calendar-sync");
      expect(ids.filter((id) => id.startsWith("system:feed-refresh"))).toEqual([feedId(WS)]);
    });

    // With no user task in tasks.json either, an empty list here is what makes "no scheduler
    // files at all" reachable — nothing is registered, so nothing records a run. A user task is
    // registered separately by `initUserTaskScheduler` and these switches do not touch it.
    it("yields no SYSTEM task when both are off and the worklog is off", () => {
      expect(build(WORKLOG_OFF, { feedRefresh: false, calendarSync: false })).toEqual([]);
    });

    // Switching the shared engines off must not take the worklog with them — it is a separate
    // opt-in feature with its own key.
    it("keeps the worklog when both shared engines are off", () => {
      const ids = build({ enabled: true, intervalHours: 6 }, { feedRefresh: false, calendarSync: false }).map((task) => task.id);
      expect(ids).toEqual(["system.worklog"]);
    });
  });

  // The feed-refresh id carries its ROOT since core 3.1.0 — the task def is per root, so two
  // roots would otherwise register one id and the second would replace the first. MulmoTerminal
  // registers one (the workspace) today. State is persisted from #1581 onward, but nothing was
  // ever written under the OLD id, so there is no stale row to clean up.
  it("registers both shared engines, the feed refresh keyed by its root", () => {
    const ids = build().map((task) => task.id);
    expect(ids).toContain(feedId(WS));
    expect(ids).toContain("system:google-calendar-sync");
  });

  // The whole list has to be takeable by the persistence adapter, not just the worklog: a def
  // missing either field cannot be caught up after the server was off (#1581).
  it("every task carries a name and a missed-run policy", () => {
    for (const task of build({ enabled: true, intervalHours: 6 })) {
      expect(task.name.length).toBeGreaterThan(0);
      expect(task.missedRunPolicy.length).toBeGreaterThan(0);
    }
  });

  // A project's feeds never refreshed on their schedule while this registered one root. It waited
  // on core 3.2.0: an `ingest.kind: "agent"` collection dispatches a worker whose seed prompt
  // addresses records ROOT-RELATIVELY, and until the runner was handed the root, a project's
  // refresh wrote into the WORKSPACE's same-named collection (shipped and reverted, #1582).
  it("registers one feed refresh per root, so a project's feeds refresh too", () => {
    expect(feedIds(buildWithRoots([WS, MAG2]))).toEqual([feedId(WS), feedId(MAG2)]);
  });

  it("keeps the workspace even when it is not among the roots passed in", () => {
    expect(feedIds(buildWithRoots([MAG2]))).toEqual([feedId(WS), feedId(MAG2)]);
  });

  // A task id is the scheduler's primary key, and core builds it from the CANONICAL root — so two
  // spellings make one id, and the second registration replaces the first rather than adding to
  // it. The dedup has to happen on the resolved path, before that.
  it("registers a directory once however it is spelled", () => {
    expect(feedIds(buildWithRoots([`${WS}${path.sep}`, MAG2, `${MAG2}${path.sep}.${path.sep}`]))).toEqual([feedId(WS), feedId(MAG2)]);
  });

  it("refreshes only the workspace when no roots are given — the pre-projects behaviour", () => {
    expect(feedIds(build())).toEqual([feedId(WS)]);
  });

  // Workspace-only, deliberately: a Google grant is user-scope and its sync marker is workspace
  // state, so there is no per-project answer to "which account".
  it("does not multiply the calendar sync per root", () => {
    const ids = buildWithRoots([WS, MAG2]).map((task) => task.id);
    expect(ids.filter((id) => id.startsWith("system:google-calendar-sync"))).toEqual(["system:google-calendar-sync"]);
  });

  // Off is the default, so the list must not carry a null through to registerTask.
  it("leaves the worklog out until it is enabled", () => {
    expect(build().map((task) => task.id)).not.toContain("system.worklog");
    expect(build({ enabled: true, intervalHours: 6 }).map((task) => task.id)).toContain("system.worklog");
  });

  it("returns no nulls", () => {
    expect(build().every(Boolean)).toBe(true);
  });
});
