// The skill evaluation panel in the Skills viewer (#3438): no tasks yet, the price asked before a run,
// a run in progress, and a finished run's verdict.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { SkillEvalOverview, SkillEvalRun } from "../../../common/skillEval";
import { skillsViewEn } from "../../../src/i18n/skillsView/en";

let overview: SkillEvalOverview | null = null;
/** When set, each load takes the next answer from here instead of `overview`. */
const loads: Promise<SkillEvalOverview | null>[] = [];
const calls: string[] = [];
const placed: unknown[] = [];
let authoring: Promise<string | null> = Promise.resolve("chat-1");
let starting: Promise<{ kind: "started"; id: string }> = Promise.resolve({ kind: "started", id: "r" });
vi.mock("../../../src/composables/skillEvalApi", () => ({
  loadSkillEval: () => loads.shift() ?? Promise.resolve(overview),
  startSkillEvalRun: (_source: unknown, _slug: string, improve?: boolean) => (calls.push(improve ? "improve" : "start"), starting),
  adoptSkillEvalCandidate: (_source: unknown, _slug: string, runId: string) => (
    calls.push(`adopt ${runId}`),
    Promise.resolve({ kind: "adopted", backup: "/b/1.md" })
  ),
  stopSkillEvalRun: () => (calls.push("stop"), Promise.resolve(true)),
  startSkillEvalAuthoring: () => (calls.push("author"), authoring),
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
  improveModel: "sonnet",
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
    ...{ skillText: "", skillHash: "h", setHash: "s", cases: [evalCase], plannedAttempts: 2, candidateId: null, note: "", improveCostUsd: 0 },
    attempts: [attempt("with", passWith), attempt("without", passWithout)],
    ...extra,
  };
}

const base = {
  ...{ skill: "weekly", dir: "/h/.mulmoterminal/skill-evals/weekly", setHash: "s", setError: null, editable: true },
  ...{ estimate: { attempts: 2, maxCostUsd: 1, maxImproveCostUsd: 2 }, activeRunId: null },
};
const mountPanel = async () => {
  const wrapper = mount(SkillEvalPanel, { props: { source, skill }, global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  calls.length = 0;
  placed.length = 0;
  loads.length = 0;
  authoring = Promise.resolve("chat-1");
  starting = Promise.resolve({ kind: "started", id: "r" });
  vi.useRealTimers();
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

  it("drops an answer for a skill no longer selected", async () => {
    let answerFirst: (value: SkillEvalOverview | null) => void = () => {};
    loads.push(new Promise((resolve) => (answerFirst = resolve)));
    overview = { ...base, set, runs: [run(true, false)] };
    const wrapper = mount(SkillEvalPanel, { props: { source, skill }, global: { plugins: [i18n] } });
    await wrapper.setProps({ skill: { ...skill, slug: "other", id: "other" } });
    await flushPromises();
    answerFirst({ ...base, set: null, estimate: null, runs: [] });
    await flushPromises();
    expect(wrapper.find("[data-testid=skill-eval-verdict]").exists()).toBe(true);
  });

  it("keeps a running run on screen through a failed read, and reads again", async () => {
    vi.useFakeTimers();
    overview = { ...base, set, runs: [run(true, false, { status: "running", attempts: [] })], activeRunId: "1795000000000-aaaaaaaa" };
    const wrapper = await mountPanel();
    loads.push(Promise.resolve(null));
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find("[data-testid=skill-eval-progress]").exists()).toBe(true);
    overview = { ...base, set, runs: [run(true, false)] };
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find("[data-testid=skill-eval-verdict]").text()).toBe("It helps");
    wrapper.unmount();
  });

  it("opens one drafting cell however often the button is pressed while it opens", async () => {
    let answer: (id: string | null) => void = () => {};
    authoring = new Promise((resolve) => (answer = resolve));
    overview = { ...base, set: null, estimate: null, runs: [] };
    const wrapper = await mountPanel();
    const button = wrapper.find("[data-testid=skill-eval-draft]");
    await button.trigger("click");
    await button.trigger("click");
    answer("chat-1");
    await flushPromises();
    expect(calls).toEqual(["author"]);
    expect(placed).toHaveLength(1);
  });

  it("follows a run it started even when the first read after starting fails", async () => {
    vi.useFakeTimers();
    overview = { ...base, set, runs: [] };
    const wrapper = await mountPanel();
    await wrapper.find("[data-testid=skill-eval-measure]").trigger("click");
    loads.push(Promise.resolve(null));
    await wrapper.find("[data-testid=skill-eval-go]").trigger("click");
    await vi.advanceTimersByTimeAsync(0);
    overview = { ...base, set, runs: [run(true, false, { status: "running", attempts: [] })], activeRunId: "1795000000000-aaaaaaaa" };
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find("[data-testid=skill-eval-progress]").exists()).toBe(true);
    wrapper.unmount();
  });

  it("starts no polling for a run whose start answered after the panel was gone", async () => {
    vi.useFakeTimers();
    let answerStart: (value: { kind: "started"; id: string }) => void = () => {};
    starting = new Promise((resolve) => (answerStart = resolve));
    overview = { ...base, set, runs: [] };
    const wrapper = await mountPanel();
    await wrapper.find("[data-testid=skill-eval-measure]").trigger("click");
    await wrapper.find("[data-testid=skill-eval-go]").trigger("click");
    wrapper.unmount();
    // The server has the run by now, so any read would say it is going and keep a poll alive.
    overview = { ...base, set, runs: [run(true, false, { status: "running", attempts: [] })], activeRunId: "r" };
    answerStart({ kind: "started", id: "r" });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("offers an improvement only once the skill has been measured on the current tasks, and names its price", async () => {
    overview = { ...base, set, runs: [] };
    expect((await mountPanel()).find("[data-testid=skill-eval-improve]").exists()).toBe(false);
    overview = { ...base, set, runs: [run(false, false, { setHash: "old tasks" })] };
    expect((await mountPanel()).find("[data-testid=skill-eval-improve]").exists()).toBe(false);
    overview = { ...base, set, runs: [run(false, false)] };
    const wrapper = await mountPanel();
    await wrapper.find("[data-testid=skill-eval-improve]").trigger("click");
    expect(wrapper.find("[data-testid=skill-eval-confirm]").text()).toContain("$2.00");
    await wrapper.find("[data-testid=skill-eval-go]").trigger("click");
    await flushPromises();
    expect(calls).toEqual(["improve"]);
  });

  it("says an improvement is being written before it is measured", async () => {
    const writing = run(false, false, { id: "1795000000001-bbbbbbbb", status: "running", attempts: [], candidateId: "1795000000001-bbbbbbbb" });
    overview = { ...base, set, runs: [writing, run(false, false)], activeRunId: writing.id };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-progress]").text()).toContain("Writing an improvement");
    wrapper.unmount();
  });

  it("sets a measured improvement beside the skill's own result, and adopts it", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better", note: "Shortened it." });
    overview = { ...base, set, runs: [improved, run(false, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-compare]").text()).toBe("Pass rate with the skill: current 0% → improvement 100%");
    expect(wrapper.find("[data-testid=skill-eval-candidate-text]").text()).toBe("better");
    await wrapper.find("[data-testid=skill-eval-adopt]").trigger("click");
    await flushPromises();
    expect(calls).toEqual(["adopt 1795000000001-bbbbbbbb"]);
    expect(wrapper.emitted("adopted")).toHaveLength(1);
    expect(wrapper.find("[data-testid=skill-eval-adopt-notice]").text()).toContain("/b/1.md");
  });

  it("does not offer to adopt over a skill that cannot be edited here", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better" });
    overview = { ...base, editable: false, set, runs: [improved, run(false, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-adopt]").exists()).toBe(false);
  });
});
