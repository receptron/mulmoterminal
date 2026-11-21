// The retrospective in /usage (#3335): the last weeks' totals, by week, project and agent.
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { LibraryRetrospective } from "../../../common/libraryRetrospective";

let answer: LibraryRetrospective | null = null;
vi.mock("../../../src/composables/libraryApi", () => ({ loadRetrospective: () => Promise.resolve(answer) }));
const UsageRetrospective = (await import("../../../src/components/usage/UsageRetrospective.vue")).default;

const week = (start: string, costUsd: number, conversations = 1, prs = 0) => ({ start_ms: new Date(start).getTime(), costUsd, conversations, prs });

describe("UsageRetrospective", () => {
  it("states the total, a row per week with a bar to scale, and projects and agents by what was spent", async () => {
    answer = {
      weeks: [week("2026-11-09T00:00:00", 2), week("2026-11-16T00:00:00", 4, 3, 2)],
      projects: [
        { cwd: "/w/app", costUsd: 5, conversations: 3, prs: 2 },
        { cwd: "", costUsd: 1, conversations: 1, prs: 0 },
      ],
      agents: [{ agent: "claude", costUsd: 6, conversations: 4, prs: 2 }],
      total: { costUsd: 6, conversations: 4, prs: 2 },
    };
    const wrapper = mount(UsageRetrospective);
    await flushPromises();
    expect(wrapper.find("[data-testid=usage-retro-total]").text()).toBe("$6.00 on 4 conversations, 2 PRs");
    const bars = wrapper.findAll("[data-testid=usage-retro-weeks] tbody .rounded-full").map((bar) => bar.attributes("style"));
    expect(bars).toEqual(["width: 50%;", "width: 100%;"]);
    expect(wrapper.find("[data-testid=usage-retro-projects]").text()).toContain("app");
    expect(wrapper.find("[data-testid=usage-retro-projects]").text()).toContain("(no directory)");
    expect(wrapper.find("[data-testid=usage-retro-agents]").text()).toContain("claude");
  });

  it("says when the index could not be read", async () => {
    answer = null;
    const wrapper = mount(UsageRetrospective);
    await flushPromises();
    expect(wrapper.text()).toContain("Could not read the Library's index.");
  });
});
