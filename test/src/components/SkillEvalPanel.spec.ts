// The skill evaluation panel in the Skills viewer (#3438): no tasks yet, the price asked before a run,
// a run in progress, and a finished run's verdict.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { SkillEvalOverview, SkillEvalRun } from "../../../common/skillEval";
import { skillsViewEn } from "../../../src/i18n/skillsView/en";

let overview: SkillEvalOverview | null = null;
const calls: string[] = [];
const placed: unknown[] = [];
vi.mock("../../../src/composables/skillEvalApi", () => ({
  loadSkillEval: () => Promise.resolve(overview),
  startSkillEvalRun: () => (calls.push("start"), Promise.resolve({ kind: "started", id: "r" })),
  stopSkillEvalRun: () => (calls.push("stop"), Promise.resolve(true)),
  startSkillEvalAuthoring: () => (calls.push("author"), Promise.resolve("chat-1")),
}));
vi.mock("../../../src/composables/useSpawnedChat", () => ({ placeSpawnedChat: (request: unknown) => placed.push(request) }));
const SkillEvalPanel = (await import("../../../src/components/SkillEvalPanel.vue")).default;

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: skillsViewEn } });
const source = { scope: "user" as const, plugin: "", dir: "/h/.claude/skills", skills: [] };
const skill = { slug: "weekly", id: "weekly", description: "", overridesUser: false };
const evalCase = { id: "a", title: "A task", kind: "use" as const, prompt: "p", check: { type: "command" as const, command: "true" } };
const set = {
  version: 1 as const,
  skill: "weekly",
  model: "haiku",
  judgeModel: "haiku",
  repeats: 1,
  maxBudgetUsdPerAttempt: 0.5,
  allowedTools: [],
  cases: [evalCase],
};

function run(passWith: boolean, passWithout: boolean, extra: Partial<SkillEvalRun> = {}): SkillEvalRun {
  const attempt = (arm: "with" | "without", pass: boolean) => ({
    ...{ caseId: "a", arm, round: 0, pass, skillInvoked: arm === "with", costUsd: 0.02, gradingCostUsd: 0, durationMs: 1 },
    ...{ finalText: "", checkOutput: "", denied: [], error: null },
  });
  return {
    ...{ id: "1795000000000-aaaaaaaa", skill: "weekly", status: "done", startedAt: 1, finishedAt: 2, model: "haiku", repeats: 1 },
    ...{ skillText: "", skillHash: "h", setHash: "s", cases: [evalCase], plannedAttempts: 2 },
    attempts: [attempt("with", passWith), attempt("without", passWithout)],
    ...extra,
  };
}

const base = { skill: "weekly", dir: "/h/.mulmoterminal/skill-evals/weekly", setError: null, estimate: { attempts: 2, maxCostUsd: 1 }, activeRunId: null };
const mountPanel = async () => {
  const wrapper = mount(SkillEvalPanel, { props: { source, skill }, global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  calls.length = 0;
  placed.length = 0;
});

describe("SkillEvalPanel", () => {
  it("offers to draft tasks when there are none, and opens the drafting cell", async () => {
    overview = { ...base, set: null, estimate: null, runs: [] };
    const wrapper = await mountPanel();
    await wrapper.find("[data-testid=skill-eval-draft]").trigger("click");
    await flushPromises();
    expect(calls).toEqual(["author"]);
    expect(placed).toEqual([{ id: "chat-1", agent: "claude", draft: false }]);
  });

  it("names the price before a run starts, and starts only on the second press", async () => {
    overview = { ...base, set, runs: [] };
    const wrapper = await mountPanel();
    await wrapper.find("[data-testid=skill-eval-measure]").trigger("click");
    expect(calls).toEqual([]);
    expect(wrapper.find("[data-testid=skill-eval-confirm]").text()).toContain("$1.00");
    await wrapper.find("[data-testid=skill-eval-go]").trigger("click");
    await flushPromises();
    expect(calls).toEqual(["start"]);
  });

  it("shows a run in progress with a way to stop it", async () => {
    overview = { ...base, set, runs: [run(true, false, { status: "running", attempts: [] })], activeRunId: "1795000000000-aaaaaaaa" };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-progress]").text()).toContain("0 / 2");
    await wrapper.find("[data-testid=skill-eval-stop]").trigger("click");
    await flushPromises();
    expect(calls).toEqual(["stop"]);
    wrapper.unmount();
  });

  it("gives a finished run's verdict and both pass rates", async () => {
    overview = { ...base, set, runs: [run(true, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-verdict]").text()).toBe("It helps");
    expect(wrapper.find("[data-testid=skill-eval-with-rate]").text()).toBe("100%");
    expect(wrapper.find("[data-testid=skill-eval-without-rate]").text()).toBe("0%");
  });

  it("says when the tasks file could not be read, and offers to fix it", async () => {
    overview = { ...base, set: null, estimate: null, setError: "cases: too small", runs: [] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-set-error]").text()).toContain("cases: too small");
    expect(wrapper.find("[data-testid=skill-eval-draft]").text()).toBe("Fix the tasks");
  });
});
