// The skill evaluation panel in the Skills viewer (#3438): no tasks yet, the price asked before a run,
// a run in progress, and a finished run's verdict.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { provideOverlayVisible } from "../../../src/composables/overlayVisibility";
import { createI18n } from "vue-i18n";
import type { SkillEvalOverview, SkillEvalRun } from "../../../common/skillEval";
import { skillsViewEn } from "../../../src/i18n/skillsView/en";

let overview: SkillEvalOverview | null = null;
/** When set, each load takes the next answer from here instead of `overview`. */
const loads: Promise<SkillEvalOverview | null>[] = [];
const calls: string[] = [];
const placed: unknown[] = [];
const authorLanguages: (string | undefined)[] = [];
let authoring: Promise<string | null> = Promise.resolve("chat-1");
let starting: Promise<{ kind: "started"; id: string }> = Promise.resolve({ kind: "started", id: "r" });
vi.mock("../../../src/composables/skillEvalApi", () => ({
  loadSkillEval: () => loads.shift() ?? Promise.resolve(overview),
  startSkillEvalRun: (_source: unknown, _slug: string, mode?: string) => (calls.push(mode === undefined || mode === "measure" ? "start" : mode), starting),
  adoptSkillEvalCandidate: (_source: unknown, _slug: string, runId: string) => (
    calls.push(`adopt ${runId}`),
    Promise.resolve({ kind: "adopted", backup: "/b/1.md" })
  ),
  stopSkillEvalRun: () => (calls.push("stop"), Promise.resolve(true)),
  startSkillEvalAuthoring: (_source: unknown, _slug: string, language?: string) => (calls.push("author"), authorLanguages.push(language), authoring),
}));
vi.mock("../../../src/composables/useSpawnedChat", () => ({ placeSpawnedChat: (request: unknown) => placed.push(request) }));
const { createDiffView } = vi.hoisted(() => ({
  createDiffView: vi.fn<(parent: HTMLElement, original: string, current: string, options: unknown) => { destroy: () => void }>(() => ({ destroy: vi.fn() })),
}));
vi.mock("../../../src/components/cmDiffView", () => ({ createDiffView }));
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
  ladder: ["haiku", "sonnet"],
  repeats: 1,
  maxBudgetUsdPerAttempt: 0.5,
  allowedTools: [],
  cases: [evalCase],
};

function run(passWith: boolean, passWithout: boolean, extra: Partial<SkillEvalRun> = {}): SkillEvalRun {
  const attempt = (arm: "with" | "without", pass: boolean) => ({
    ...{ caseId: "a", arm, round: 0, pass, skillInvoked: arm === "with", costUsd: 0.02, gradingCostUsd: 0, durationMs: 1 },
    ...{ finalText: "", checkOutput: "", denied: [], error: null, model: "haiku", reusedFrom: "" },
  });
  return {
    ...{ id: "1795000000000-aaaaaaaa", skill: "weekly", status: "done", startedAt: 1, finishedAt: 2, model: "haiku", repeats: 1 },
    ...{
      skillText: "",
      skillHash: "h",
      setHash: "s",
      cases: [evalCase],
      plannedAttempts: 2,
      candidateId: null,
      note: "",
      improveCostUsd: 0,
      baseSkillHash: "",
      baseRunId: null,
      ladder: [],
      interruptedBy: "",
    },
    attempts: [attempt("with", passWith), attempt("without", passWithout)],
    ...extra,
  };
}

const base = {
  ...{ skill: "weekly", dir: "/h/.mulmoterminal/skill-evals/weekly", setHash: "s", skillHash: "h", setError: null, editable: true, baseline: null },
  ...{ estimate: { attempts: 2, maxCostUsd: 1, improveAttempts: 1, maxImproveCostUsd: 2, ladderAttempts: 2, maxLadderCostUsd: 1.5 }, activeRunId: null },
};
const mountPanel = async () => {
  const wrapper = mount(SkillEvalPanel, { props: { source, skill }, global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  createDiffView.mockClear();
  calls.length = 0;
  placed.length = 0;
  authorLanguages.length = 0;
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
    // The cell talks in the screen's language from its first message.
    expect(authorLanguages).toEqual(["en"]);
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

  it("names a task that passed with the skill and without it alike, and marks it among the tasks", async () => {
    overview = { ...base, set, runs: [run(true, true)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-either-way]").text()).toContain(`Passed every time with the skill and without it: ${evalCase.title}.`);
    expect(wrapper.find("[data-testid=skill-eval-case]").text()).toContain("(passes either way)");
    overview = { ...base, set, runs: [run(true, false)] };
    const other = await mountPanel();
    expect(other.find("[data-testid=skill-eval-either-way]").exists()).toBe(false);
    expect(other.find("[data-testid=skill-eval-case]").text()).not.toContain("(passes either way)");
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

  // The Skills screen is kept while closed: polling stops then, and a run still going when it is
  // shown again keeps being followed even if the read on showing fails.
  it("follows a running run again after a hide and a failed read on showing", async () => {
    vi.useFakeTimers();
    overview = { ...base, set, runs: [run(true, false, { status: "running", attempts: [] })], activeRunId: "1795000000000-aaaaaaaa" };
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(SkillEvalPanel, { source, skill })) });
    const wrapper = mount(Host, { global: { plugins: [i18n] } });
    await flushPromises();
    visible.value = false;
    await flushPromises();
    loads.push(Promise.resolve(null));
    visible.value = true;
    await flushPromises();
    expect(wrapper.find("[data-testid=skill-eval-progress]").exists()).toBe(true);
    overview = { ...base, set, runs: [run(true, false)] };
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find("[data-testid=skill-eval-verdict]").text()).toBe("It helps");
    wrapper.unmount();
  });

  it("believes the read made on showing again over one still out from before the hide", async () => {
    vi.useFakeTimers();
    const running = { ...base, set, runs: [run(true, false, { status: "running", attempts: [] })], activeRunId: "1795000000000-aaaaaaaa" };
    overview = running;
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(SkillEvalPanel, { source, skill })) });
    const wrapper = mount(Host, { global: { plugins: [i18n] } });
    await flushPromises();
    let release: (value: SkillEvalOverview) => void = () => {};
    loads.push(new Promise((resolve) => (release = resolve)));
    await vi.advanceTimersByTimeAsync(3000); // a poll read goes out and waits
    visible.value = false;
    await flushPromises();
    overview = { ...base, set, runs: [run(true, false)] };
    visible.value = true;
    await flushPromises();
    release(running);
    await flushPromises();
    expect(wrapper.find("[data-testid=skill-eval-verdict]").text()).toBe("It helps");
    wrapper.unmount();
  });

  it("follows a run whose start answers after the panel was hidden and shown again", async () => {
    overview = { ...base, set, runs: [] };
    let answerStart: (value: { kind: "started"; id: string }) => void = () => {};
    starting = new Promise((resolve) => (answerStart = resolve));
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(SkillEvalPanel, { source, skill })) });
    const wrapper = mount(Host, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.find("[data-testid=skill-eval-measure]").trigger("click");
    await wrapper.find("[data-testid=skill-eval-go]").trigger("click");
    visible.value = false;
    await flushPromises();
    visible.value = true;
    await flushPromises(); // the read on showing again found no run yet
    overview = { ...base, set, runs: [run(true, false, { status: "running", attempts: [] })], activeRunId: "1795000000000-aaaaaaaa" };
    answerStart({ kind: "started", id: "r" });
    await flushPromises();
    expect(wrapper.find("[data-testid=skill-eval-progress]").exists()).toBe(true);
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

  it("offers an improvement only when there is a measurement to write it from, and names its price", async () => {
    overview = { ...base, set, runs: [run(false, false)] };
    expect((await mountPanel()).find("[data-testid=skill-eval-improve]").exists()).toBe(false);
    overview = { ...base, set, runs: [run(false, false)], baseline: run(false, false) };
    const wrapper = await mountPanel();
    await wrapper.find("[data-testid=skill-eval-improve]").trigger("click");
    expect(wrapper.find("[data-testid=skill-eval-confirm]").text()).toContain("$2.00");
    expect(wrapper.find("[data-testid=skill-eval-confirm]").text()).toContain("in 1 runs");
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

  it("shows what a writer that failed cost, once its run is over", async () => {
    const failed = run(false, false, { id: "1795000000001-bbbbbbbb", status: "interrupted", attempts: [], candidateId: "1795000000001-bbbbbbbb" });
    Object.assign(failed, { note: "the improvement changed nothing", improveCostUsd: 0.25 });
    overview = { ...base, set, runs: [failed, run(false, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-candidate-failed]").text()).toContain("the improvement changed nothing");
    expect(wrapper.text()).toContain("$0.25");
  });

  it("says an improvement passed less often, naming the tasks, and still lets it be adopted", async () => {
    const worse = run(false, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "worse" });
    worse.baseRunId = "1795000000000-aaaaaaaa";
    overview = { ...base, set, runs: [worse, run(true, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-change]").text()).toBe(
      "The improvement passes less often than the skill it was written from, by more than the runs vary.",
    );
    expect(wrapper.find("[data-testid=skill-eval-worse-tasks]").text()).toBe(`Tasks it passed less often: ${evalCase.title}`);
    expect(wrapper.find("[data-testid=skill-eval-adopt]").exists()).toBe(true);
  });

  it("says nothing about the change when the run it was written from is no longer listed", async () => {
    const orphan = run(true, false, {
      id: "1795000000001-bbbbbbbb",
      candidateId: "1795000000001-bbbbbbbb",
      skillText: "better",
      baseRunId: "1795000000000-cccccccc",
    });
    overview = { ...base, set, runs: [orphan] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-change]").exists()).toBe(false);
  });

  it("sets a measured improvement beside the skill's own result, and adopts it", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better", note: "Shortened it." });
    improved.baseRunId = "1795000000000-aaaaaaaa";
    overview = { ...base, set, runs: [improved, run(false, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-compare]").text()).toBe("Pass rate with the skill: current 0% → improvement 100%");
    expect(wrapper.find("[data-testid=skill-eval-change]").text()).toBe(
      "The improvement passes more often than the skill it was written from, by more than the runs vary.",
    );
    expect(wrapper.find("[data-testid=skill-eval-worse-tasks]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=skill-eval-candidate-text]").text()).toBe("better");
    await wrapper.find("[data-testid=skill-eval-adopt]").trigger("click");
    await flushPromises();
    expect(calls).toEqual(["adopt 1795000000001-bbbbbbbb"]);
    expect(wrapper.emitted("adopted")).toHaveLength(1);
    expect(wrapper.find("[data-testid=skill-eval-adopt-notice]").text()).toContain("/b/1.md");
  });

  it("shows an improvement as its change to the SKILL.md it was written from", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better" });
    improved.baseRunId = "1795000000000-aaaaaaaa";
    overview = { ...base, set, runs: [improved, run(false, false, { skillText: "plain" })] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-candidate-diff]").exists()).toBe(true);
    expect(createDiffView.mock.calls.map((call) => [call[1], call[2]])).toEqual([["plain", "better"]]);
    expect(createDiffView.mock.calls[0]?.[3]).toMatchObject({ phrases: { "$ unchanged lines": "$ unchanged lines" } });
    // The whole text is still there for whoever wants it.
    expect(wrapper.find("[data-testid=skill-eval-candidate-text]").text()).toBe("better");
  });

  it("shows no change when the run it was written from is no longer listed", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better" });
    improved.baseRunId = "1795000000000-gonegone";
    overview = { ...base, set, runs: [improved, run(false, false, { skillText: "plain" })] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-candidate-diff]").exists()).toBe(false);
    expect(createDiffView).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid=skill-eval-candidate-text]").text()).toBe("better");
  });
  it("says the runs without the skill were copied, and leaves their cost out of what the run spent", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better", improveCostUsd: 0.3 });
    improved.attempts = improved.attempts.map((attempt) => (attempt.arm === "without" ? { ...attempt, reusedFrom: "1795000000000-aaaaaaaa" } : attempt));
    improved.baseRunId = "1795000000000-aaaaaaaa";
    overview = { ...base, set, runs: [improved, run(false, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-reused]").exists()).toBe(true);
    // The writer and the one attempt with the skill; the copied attempt without it cost this run nothing.
    expect(wrapper.find("[data-testid=skill-eval-result]").text()).toContain("This evaluation cost $0.32");
    overview = { ...base, set, runs: [run(true, false)] };
    expect((await mountPanel()).find("[data-testid=skill-eval-reused]").exists()).toBe(false);
  });

  it("counts only the attempts a running improvement makes itself", async () => {
    const measuring = run(true, false, { id: "1795000000001-bbbbbbbb", status: "running", candidateId: "1795000000001-bbbbbbbb", skillText: "better" });
    measuring.attempts = measuring.attempts.filter((attempt) => attempt.arm === "without").map((attempt) => ({ ...attempt, reusedFrom: "x" }));
    measuring.plannedAttempts = 1;
    overview = { ...base, set, runs: [measuring, run(false, false)], activeRunId: measuring.id };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-progress]").text()).toContain("0 / 1");
    wrapper.unmount();
  });

  it("does not set beside the skill an improvement measured on tasks that have since changed", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better", setHash: "old tasks" });
    overview = { ...base, set, runs: [improved, run(false, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-adopt]").exists()).toBe(false);
  });

  it("does not offer to adopt over a skill that cannot be edited here", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillText: "better" });
    overview = { ...base, editable: false, set, runs: [improved, run(false, false)] };
    const wrapper = await mountPanel();
    expect(wrapper.find("[data-testid=skill-eval-adopt]").exists()).toBe(false);
  });
  describe("searching for the cheapest model", () => {
    const tried = (model: string, pass: boolean, round: number) => ({
      ...{ caseId: "a", arm: "with" as const, round, pass, skillInvoked: true, costUsd: 0.1, gradingCostUsd: 0, durationMs: 1 },
      ...{ finalText: "", checkOutput: "", denied: [], error: null, model, reusedFrom: "" },
    });
    const search = (attempts: ReturnType<typeof tried>[], extra: Partial<SkillEvalRun> = {}) =>
      run(false, false, { id: "1795000000002-cccccccc", ladder: ["haiku", "sonnet", "opus"], attempts, plannedAttempts: 6, ...extra });

    it("names the search's price before it starts, and starts it", async () => {
      overview = { ...base, set, runs: [] };
      const wrapper = await mountPanel();
      await wrapper.find("[data-testid=skill-eval-ladder]").trigger("click");
      expect(wrapper.find("[data-testid=skill-eval-confirm]").text()).toContain("$1.50");
      await wrapper.find("[data-testid=skill-eval-go]").trigger("click");
      await flushPromises();
      expect(calls).toEqual(["ladder"]);
    });

    it("offers no search when no task is one the skill should help with", async () => {
      overview = { ...base, set, runs: [], estimate: { ...base.estimate, ladderAttempts: 0 } };
      expect((await mountPanel()).find("[data-testid=skill-eval-ladder]").exists()).toBe(false);
    });

    it("shows each model cheapest first, the one that is enough, and the ones it did not need to measure", async () => {
      overview = { ...base, set, runs: [search([tried("haiku", false, 0), tried("haiku", false, 1), tried("sonnet", true, 0), tried("sonnet", true, 1)])] };
      const wrapper = await mountPanel();
      expect(wrapper.find("[data-testid=skill-eval-result]").exists()).toBe(false);
      expect(wrapper.find("[data-testid=skill-eval-ladder-enough]").text()).toContain("sonnet is enough");
      const rows = wrapper.findAll("[data-testid=skill-eval-ladder-step]").map((row) => row.text());
      expect(rows[0]).toContain("0% (0/2)");
      expect(rows[1]).toContain("100% (2/2)");
      expect(rows[1]).toContain("$0.100");
      expect(rows[2]).toContain("Not measured");
      expect(wrapper.text()).toContain("Only one model passed");
    });

    it("names no model for a search that was stopped, here and among the earlier results", async () => {
      const stopped = search([tried("haiku", true, 0)], { status: "stopped" });
      overview = { ...base, set, runs: [stopped, stopped] };
      const wrapper = await mountPanel();
      expect(wrapper.find("[data-testid=skill-eval-ladder-enough]").text()).toContain("did not finish");
      expect(wrapper.find("[data-testid=skill-eval-earlier]").text()).toContain("not finished");
      expect(wrapper.findAll("[data-testid=skill-eval-ladder-step]")[1]?.text()).toContain("the search ended before it");
    });

    it("says how far a running search has got, and what an earlier one found", async () => {
      const going = search([tried("haiku", false, 0)], { status: "running" });
      overview = { ...base, set, runs: [going], activeRunId: going.id };
      const wrapper = await mountPanel();
      expect(wrapper.find("[data-testid=skill-eval-progress]").text()).toContain("Trying models, cheapest first… 1 / at most 6");
      expect(wrapper.findAll("[data-testid=skill-eval-ladder-step]")[1]?.text()).toContain("Not measured yet");
      wrapper.unmount();
      overview = { ...base, set, runs: [run(true, false), search([tried("haiku", true, 0), tried("haiku", true, 1)])] };
      expect((await mountPanel()).find("[data-testid=skill-eval-earlier]").text()).toContain("enough: haiku · done · model search");
    });
  });
  it("lists earlier runs with their pass rates, says which measured other text, and opens each to its result", async () => {
    const older = run(false, false, { id: "1795000000000-oooooooo", skillHash: "old text" });
    overview = { ...base, set, runs: [run(true, false, { id: "1795000000002-cccccccc" }), run(true, false), older] };
    const wrapper = await mountPanel();
    const rows = wrapper.findAll("[data-testid=skill-eval-earlier]");
    expect(rows.map((row) => row.find("summary").text())).toEqual([
      expect.stringContaining("with the skill 100%, without 0% · It helps · done"),
      expect.stringContaining("with the skill 0%, without 0% · No evidence of a difference · done"),
    ]);
    expect(rows.map((row) => row.find("[data-testid=skill-eval-earlier-other-text]").exists())).toEqual([false, true]);
    // Each opens to the result as it was shown then.
    const row = rows[1]?.find("details");
    expect(row?.element.hasAttribute("open")).toBe(false);
    await row?.find("summary").trigger("click");
    expect(row?.element.hasAttribute("open")).toBe(true);
    expect(row?.find("[data-testid=skill-eval-result] [data-testid=skill-eval-with-rate]").text()).toBe("0%");
  });

  it("does not call an improvement's own text another SKILL.md, nor judge a run against a text it could not read", async () => {
    const improved = run(true, false, { id: "1795000000001-bbbbbbbb", candidateId: "1795000000001-bbbbbbbb", skillHash: "c" });
    overview = { ...base, set, runs: [run(true, false, { id: "1795000000002-cccccccc" }), improved] };
    expect((await mountPanel()).find("[data-testid=skill-eval-earlier-other-text]").exists()).toBe(false);
    overview = { ...base, set, skillHash: null, runs: [run(true, false, { id: "1795000000002-cccccccc" }), run(true, false, { skillHash: "x" })] };
    expect((await mountPanel()).find("[data-testid=skill-eval-earlier-other-text]").exists()).toBe(false);
  });

  it("points at the one step to take next, and makes its button stand out", async () => {
    overview = { ...base, set, runs: [] };
    const fresh = await mountPanel();
    expect(fresh.find("[data-testid=skill-eval-next]").text()).toContain("has not been measured on these tasks yet");
    expect(fresh.find("[data-testid=skill-eval-measure]").classes()).toContain("bg-accent");
    expect(fresh.find("[data-testid=skill-eval-ladder]").classes()).not.toContain("bg-accent");
    overview = { ...base, set, runs: [run(false, false)], baseline: run(false, false) };
    const measured = await mountPanel();
    expect(measured.find("[data-testid=skill-eval-improve]").classes()).toContain("bg-accent");
    expect(measured.find("[data-testid=skill-eval-measure]").classes()).not.toContain("bg-accent");
    // While the price is being confirmed, the confirmation is the one thing to read.
    await measured.find("[data-testid=skill-eval-improve]").trigger("click");
    expect(measured.find("[data-testid=skill-eval-next]").exists()).toBe(false);
  });

  it("says why a run stopped partway when something failed", async () => {
    overview = { ...base, set, runs: [run(true, false, { status: "interrupted", interruptedBy: "EPERM: operation not permitted" })] };
    expect((await mountPanel()).find("[data-testid=skill-eval-interrupted-by]").text()).toContain("EPERM: operation not permitted");
  });
});
