// @vitest-environment node
// The retrospective's arithmetic (#3335): totals by week, project and agent, from the index's rows.
import { describe, it, expect } from "vitest";
import { retrospective, weekStart, type RetrospectiveRow } from "../../../../server/backends/library/retrospective";
import { RETROSPECTIVE_WEEKS } from "../../../../common/libraryRetrospective";

const at = (iso: string): number => new Date(iso).getTime();
const NOW = at("2026-11-21T12:00:00"); // a Saturday, local time

describe("weekStart", () => {
  it("is local midnight of the Monday on or before", () => {
    expect(weekStart(NOW)).toBe(at("2026-11-16T00:00:00"));
    expect(weekStart(at("2026-11-16T00:00:00"))).toBe(at("2026-11-16T00:00:00"));
    expect(weekStart(at("2026-11-15T23:59:59"))).toBe(at("2026-11-09T00:00:00"));
  });
});

describe("retrospective", () => {
  const row = (over: Partial<RetrospectiveRow>): RetrospectiveRow => ({ cwd: "/w/app", agent: "claude", startedAt: NOW, costUsd: 1, prs: 0, ...over });

  it("adds each conversation to the week it started in, every week present, oldest first", () => {
    const result = retrospective([row({ costUsd: 2 }), row({ startedAt: at("2026-11-10T09:00:00"), costUsd: 0.5, prs: 1 })], NOW);
    expect(result.weeks).toHaveLength(RETROSPECTIVE_WEEKS);
    expect(result.weeks.at(-1)).toEqual({ start_ms: at("2026-11-16T00:00:00"), costUsd: 2, conversations: 1, prs: 0 });
    expect(result.weeks.at(-2)).toEqual({ start_ms: at("2026-11-09T00:00:00"), costUsd: 0.5, conversations: 1, prs: 1 });
    expect(result.weeks.slice(0, -2).every((week) => week.conversations === 0)).toBe(true);
    expect(result.total).toEqual({ costUsd: 2.5, conversations: 2, prs: 1 });
  });

  it("orders projects and agents by what was spent, a missing cost counting as nothing", () => {
    const result = retrospective(
      [row({ cwd: "/w/small", costUsd: 1 }), row({ cwd: "/w/big", costUsd: 5 }), row({ cwd: null, costUsd: null }), row({ agent: "codex", costUsd: 3 })],
      NOW,
    );
    expect(result.projects.map((project) => [project.cwd, project.costUsd])).toEqual([
      ["/w/big", 5],
      ["/w/app", 3],
      ["/w/small", 1],
      ["", 0],
    ]);
    expect(result.agents.map((agent) => [agent.agent, agent.costUsd, agent.conversations])).toEqual([
      ["claude", 6, 3],
      ["codex", 3, 1],
    ]);
  });

  it("leaves out what started before the first week shown, or at no known time", () => {
    const tooOld = at("2026-01-05T09:00:00");
    expect(retrospective([row({ startedAt: tooOld }), row({ startedAt: null })], NOW).total.conversations).toBe(0);
  });
});
