// The retrospective in /usage (#3335, #3395): the last weeks' totals, by week, project, agent and model.
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LibraryRetrospective } from "../../../common/libraryRetrospective";

let answer: LibraryRetrospective | null = null;
vi.mock("../../../src/composables/libraryApi", () => ({ loadRetrospective: () => Promise.resolve(answer) }));
const UsageRetrospective = (await import("../../../src/components/usage/UsageRetrospective.vue")).default;

const week = (start: string, costUsd: number, conversations = 1, prs = 0) => ({ start_ms: new Date(start).getTime(), costUsd, conversations, prs });

describe("UsageRetrospective", () => {
  it("states the total and the tokens, a row per week with a bar to scale, and projects, agents and models by what was spent", async () => {
    answer = {
      weeks: [week("2026-11-09T00:00:00", 2), week("2026-11-16T00:00:00", 4, 3, 2)],
      projects: [
        { cwd: "/w/app", costUsd: 5, conversations: 3, prs: 2 },
        { cwd: "", costUsd: 1, conversations: 1, prs: 0 },
      ],
      agents: [{ agent: "claude", costUsd: 6, conversations: 4, prs: 2 }],
      models: [
        { model: "claude-opus-5", costUsd: 5.5, tokens: { input: 1200, output: 34_000, cacheRead: 2_500_000, cacheWrite: 90_000 } },
        { model: "", costUsd: 0.5, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      ],
      total: { costUsd: 6, conversations: 4, prs: 2, tokens: { input: 1200, output: 34_000, cacheRead: 2_500_000, cacheWrite: 90_000 } },
    };
    const wrapper = mount(UsageRetrospective);
    await flushPromises();
    expect(wrapper.find("[data-testid=usage-retro-total]").text()).toBe("$6.00 on 4 conversations, 2 PRs");
    const bars = wrapper.findAll("[data-testid=usage-retro-weeks] tbody .rounded-full").map((bar) => bar.attributes("style"));
    expect(bars).toEqual(["width: 50%;", "width: 100%;"]);
    expect(wrapper.find("[data-testid=usage-retro-projects]").text()).toContain("app");
    expect(wrapper.find("[data-testid=usage-retro-projects]").text()).toContain("(no directory)");
    expect(wrapper.find("[data-testid=usage-retro-agents]").text()).toContain("claude");
    expect(wrapper.find("[data-testid=usage-retro-tokens]").text()).toBe("Tokens: 1.2K input, 34K output, 2.5M read from cache, 90K written to cache");
    const models = wrapper.findAll("[data-testid=usage-retro-models] tbody tr").map((row) => row.findAll("td").map((cell) => cell.text()));
    expect(models).toEqual([
      ["claude-opus-5", "$5.50", "1.2K", "34K", "2.5M", "90K"],
      ["(model not recorded)", "$0.50", "0", "0", "0", "0"],
    ]);
  });

  it("says when the index could not be read", async () => {
    answer = null;
    const wrapper = mount(UsageRetrospective);
    await flushPromises();
    expect(wrapper.text()).toContain("Could not read the Library's index.");
  });
});
