// @vitest-environment node
// The retrospective's arithmetic (#3335, #3395): totals by week, project, agent and model, from the index's rows.
import { describe, it, expect } from "vitest";
import { retrospective, weekStart, type RetrospectiveRow, type RetrospectiveSpend } from "../../../../server/backends/library/retrospective";
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
  const row = (over: Partial<RetrospectiveRow>): RetrospectiveRow => ({ cwd: "/w/app", agent: "claude", startedAt: NOW, prs: 0, ...over });
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const spend = (over: Partial<RetrospectiveSpend>): RetrospectiveSpend => ({
    ...{ cwd: "/w/app", agent: "claude", at_ms: NOW, model: "claude-opus-5", costUsd: 1 },
    ...tokens,
    ...over,
  });

  it("counts a conversation in the week it started and its cost in the week it was spent, every week present", () => {
    const longOne = row({ startedAt: at("2026-11-03T09:00:00"), prs: 1 });
    const spent = [spend({ at_ms: at("2026-11-03T10:00:00"), costUsd: 0.5 }), spend({ at_ms: at("2026-11-17T10:00:00"), costUsd: 2 })];
    const result = retrospective([longOne, row({})], spent, NOW);
    expect(result.weeks).toHaveLength(RETROSPECTIVE_WEEKS);
    expect(result.weeks.slice(-3)).toEqual([
      { start_ms: at("2026-11-02T00:00:00"), costUsd: 0.5, conversations: 1, prs: 1 },
      { start_ms: at("2026-11-09T00:00:00"), costUsd: 0, conversations: 0, prs: 0 },
      { start_ms: at("2026-11-16T00:00:00"), costUsd: 2, conversations: 1, prs: 0 },
    ]);
    expect(result.weeks.slice(0, -3).every((week) => week.conversations === 0 && week.costUsd === 0)).toBe(true);
    expect(result.total).toEqual({ costUsd: 2.5, conversations: 2, prs: 1, tokens });
  });

  it("orders projects, agents and models by what was spent, a project that only spent included", () => {
    const result = retrospective(
      [row({ cwd: "/w/small" }), row({ cwd: null }), row({ agent: "codex" })],
      [
        spend({ cwd: "/w/small", costUsd: 1 }),
        spend({ cwd: "/w/big", costUsd: 5, model: "claude-fable-5-1", output: 10 }),
        spend({ costUsd: 3, input: 7, cacheRead: 2 }),
        spend({ cwd: "/w/big", costUsd: 0.5, model: "", cacheWrite: 4 }),
      ],
      NOW,
    );
    expect(result.projects.map((project) => [project.cwd, project.costUsd, project.conversations])).toEqual([
      ["/w/big", 5.5, 0],
      ["/w/app", 3, 1],
      ["/w/small", 1, 1],
      ["", 0, 1],
    ]);
    expect(result.agents.map((agent) => [agent.agent, agent.costUsd, agent.conversations])).toEqual([
      ["claude", 9.5, 2],
      ["codex", 0, 1],
    ]);
    expect(result.models).toEqual([
      { model: "claude-fable-5-1", costUsd: 5, tokens: { ...tokens, output: 10 } },
      { model: "claude-opus-5", costUsd: 4, tokens: { ...tokens, input: 7, cacheRead: 2 } },
      { model: "", costUsd: 0.5, tokens: { ...tokens, cacheWrite: 4 } },
    ]);
    expect(result.total.tokens).toEqual({ input: 7, output: 10, cacheRead: 2, cacheWrite: 4 });
  });

  it("leaves out what started or was spent before the first week shown, and a conversation at no known time", () => {
    const tooOld = at("2026-01-05T09:00:00");
    const result = retrospective([row({ startedAt: tooOld }), row({ startedAt: null })], [spend({ at_ms: tooOld })], NOW);
    expect(result.total).toEqual({ costUsd: 0, conversations: 0, prs: 0, tokens });
    expect(result.models).toEqual([]);
  });
});
