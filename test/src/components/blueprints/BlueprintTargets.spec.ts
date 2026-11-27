// The work list in the run view: a row per target with where it stands, a detail on click, the decision row marked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";
import { ref } from "vue";
import { basePlanSchema } from "../../../../common/blueprint/plan";
import { initialState, type BlueprintState, type StepStatus } from "../../../../common/blueprint/state";
import type { Target } from "../../../../common/blueprint/targets";

const { loadTargets } = vi.hoisted(() => ({ loadTargets: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/composables/blueprintsApi")>();
  return { ...actual, loadTargets };
});

const BlueprintTargets = (await import("../../../../src/components/blueprints/BlueprintTargets.vue")).default;

const steps = basePlanSchema.parse({
  steps: [
    { id: "survey", title: "survey", skill: "s", check: "true" },
    { id: "tranche", title: "tranche", skill: "s", check: "true", repeatWhile: "true" },
  ],
}).steps;

const at = (survey: StepStatus, tranche: StepStatus, round?: number): BlueprintState => {
  const state = initialState(steps);
  return { steps: { survey: { ...state.steps.survey, status: survey }, tranche: { ...state.steps.tranche, status: tranche, round } } };
};

const targets: Target[] = [
  {
    id: "ci",
    title: "CI に型検査を足す",
    kind: "ci",
    files: [".github/workflows/ci.yml"],
    status: "done",
    pr: "https://github.com/o/r/pull/7",
    why: "CI が型を見ていない",
  },
  { id: "money", title: "金額の計算に試験", kind: "test", files: ["src/price.ts"], status: "todo", proof: "生成した注文で旧新を比べる" },
  { id: "style", title: "体裁の値", files: ["src/a.ts"], status: "skipped", note: "論理ではない", pr: "javascript:alert(1)" },
];

const listed = (list: Target[] | null, problem: string | null = null) => ({ ok: true, value: { targets: list, problem } });

type Listed = ReturnType<typeof listed> | { ok: false; error: string };
const deferred = (): { promise: Promise<Listed>; resolve: (value: Listed) => void } => {
  const box: { resolve: (value: Listed) => void } = { resolve: () => undefined };
  const promise = new Promise<Listed>((resolve) => (box.resolve = resolve));
  return { promise, resolve: (value) => box.resolve(value) };
};

const mountTable = async (state: BlueprintState) => {
  const wrapper = mount(BlueprintTargets, { props: { runId: "run-00000001", steps, state } });
  await flushPromises();
  return wrapper;
};

describe("the work list in the run view", () => {
  beforeEach(() => loadTargets.mockReset());

  it("shows nothing until the build has written a list", async () => {
    loadTargets.mockResolvedValue(listed(null));
    const wrapper = await mountTable(at("running", "pending"));
    expect(wrapper.find('[data-testid="blueprint-targets"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="blueprint-targets-problem"]').exists()).toBe(false);
  });

  it("says when the list cannot be read", async () => {
    loadTargets.mockResolvedValue(listed(null, ".blueprint/targets.json is not JSON"));
    const wrapper = await mountTable(at("passed", "running"));
    expect(wrapper.get('[data-testid="blueprint-targets-problem"]').text()).toContain(".blueprint/targets.json is not JSON");
  });

  it("lists every target in order with where it stands, the one in progress included", async () => {
    loadTargets.mockResolvedValue(listed(targets));
    const wrapper = await mountTable(at("passed", "running"));
    const rows = wrapper.findAll('[data-testid="blueprint-target"]');
    expect(rows.map((row) => row.attributes("data-phase"))).toEqual(["done", "working", "skipped"]);
    expect(rows[1].text()).toContain("金額の計算に試験");
    expect(rows[1].text()).toContain("In progress");
  });

  it("tints the target waiting for a decision", async () => {
    loadTargets.mockResolvedValue(listed(targets));
    const wrapper = await mountTable(at("passed", "awaiting-answer"));
    const row = wrapper.findAll('[data-testid="blueprint-target"]')[1];
    expect(row.attributes("data-phase")).toBe("needs-decision");
    expect(row.classes()).toContain("bg-[var(--warn-bg-subtle)]");
    expect(row.text()).toContain("Needs your decision");
  });

  it("opens a row's detail on click and closes it on a second click", async () => {
    loadTargets.mockResolvedValue(listed(targets));
    const wrapper = await mountTable(at("passed", "running"));
    const row = wrapper.findAll('[data-testid="blueprint-target"]')[0];
    await row.trigger("click");
    const detail = wrapper.get('[data-testid="blueprint-target-detail"]');
    expect(detail.text()).toContain("CI が型を見ていない");
    expect(detail.text()).toContain(".github/workflows/ci.yml");
    expect(detail.get('[data-testid="blueprint-target-pr"]').attributes("href")).toBe("https://github.com/o/r/pull/7");
    expect(row.attributes("aria-expanded")).toBe("true");
    await row.trigger("click");
    expect(wrapper.find('[data-testid="blueprint-target-detail"]').exists()).toBe(false);
  });

  it("opens a row from the keyboard", async () => {
    loadTargets.mockResolvedValue(listed(targets));
    const wrapper = await mountTable(at("passed", "running"));
    await wrapper.findAll('[data-testid="blueprint-target"]')[1].trigger("keydown", { key: "Enter" });
    expect(wrapper.get('[data-testid="blueprint-target-detail"]').text()).toContain("生成した注文で旧新を比べる");
  });

  it("does not make a link of anything but a GitHub pull request", async () => {
    loadTargets.mockResolvedValue(listed(targets));
    const wrapper = await mountTable(at("passed", "running"));
    await wrapper.findAll('[data-testid="blueprint-target"]')[2].trigger("click");
    const detail = wrapper.get('[data-testid="blueprint-target-detail"]');
    expect(detail.text()).toContain("論理ではない");
    expect(detail.find('[data-testid="blueprint-target-pr"]').exists()).toBe(false);
    expect(detail.find("a").exists()).toBe(false);
  });

  it("reads the list again when a round moves on, and not on an unrelated re-render", async () => {
    loadTargets.mockResolvedValue(listed(targets));
    const wrapper = await mountTable(at("passed", "running", 1));
    expect(loadTargets).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ state: at("passed", "running", 1) });
    await flushPromises();
    expect(loadTargets).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ state: at("passed", "running", 2) });
    await flushPromises();
    expect(loadTargets).toHaveBeenCalledTimes(2);
    await wrapper.setProps({ state: at("passed", "awaiting-answer", 2) });
    await flushPromises();
    expect(loadTargets).toHaveBeenCalledTimes(3);
  });

  it("keeps the newer list when an older load for the same build returns last", async () => {
    const older = deferred();
    const newer = deferred();
    loadTargets.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const wrapper = mount(BlueprintTargets, { props: { runId: "run-00000001", steps, state: at("passed", "awaiting-answer", 1) } });
    await wrapper.setProps({ state: at("passed", "running", 1) });
    newer.resolve(listed([{ ...targets[1], title: "after the answer" }]));
    await flushPromises();
    older.resolve(listed([{ ...targets[1], title: "before the answer" }]));
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-target"]').text()).toContain("after the answer");
  });

  it("drops another build's list as soon as the build changes", async () => {
    loadTargets.mockResolvedValueOnce(listed(targets));
    const wrapper = await mountTable(at("passed", "running"));
    const pending = deferred();
    loadTargets.mockReturnValueOnce(pending.promise);
    await wrapper.setProps({ runId: "run-00000002" });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-targets"]').exists()).toBe(false);
    pending.resolve(listed([{ ...targets[0], title: "the other build" }]));
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-target"]').text()).toContain("the other build");
  });

  it("says when the list could not be loaded, and loads it again on request", async () => {
    loadTargets.mockResolvedValueOnce({ ok: false, error: "network down" });
    const wrapper = await mountTable(at("passed", "running"));
    expect(wrapper.get('[data-testid="blueprint-targets-load-error"]').text()).toContain("network down");
    expect(wrapper.find('[data-testid="blueprint-targets"]').exists()).toBe(false);
    loadTargets.mockResolvedValueOnce(listed(targets));
    await wrapper.get('[data-testid="blueprint-targets-reload"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-targets-load-error"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="blueprint-target"]')).toHaveLength(targets.length);
  });

  it("does not let an older failed load hide a newer list", async () => {
    const older = deferred();
    loadTargets.mockReturnValueOnce(older.promise).mockResolvedValueOnce(listed(targets));
    const wrapper = mount(BlueprintTargets, { props: { runId: "run-00000001", steps, state: at("passed", "awaiting-answer", 1) } });
    await wrapper.setProps({ state: at("passed", "running", 1) });
    await flushPromises();
    older.resolve({ ok: false, error: "late failure" });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-targets-load-error"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="blueprint-target"]')).toHaveLength(targets.length);
  });
});

// The Blueprints screen is kept while closed: the list may have been rewritten with no step moving.
describe("the work list shown again", () => {
  it("is read again each time the screen is shown", async () => {
    loadTargets.mockReset();
    loadTargets.mockResolvedValue(listed(null));
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintTargets, { runId: "run-00000001", steps, state: at("passed", "awaiting-answer", 1) });
    await flushPromises();
    await showAgain();
    expect(loadTargets).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});

describe("a step moving while the screen is hidden", () => {
  it("reads the list on showing, not while hidden", async () => {
    loadTargets.mockReset();
    loadTargets.mockResolvedValue(listed(null));
    const round = ref(1);
    const { wrapper, visible } = mountUnderOverlay(BlueprintTargets, () => ({
      runId: "run-00000001",
      steps,
      state: at("passed", "awaiting-answer", round.value),
    }));
    await flushPromises();
    visible.value = false;
    await flushPromises();
    loadTargets.mockClear();
    round.value = 2;
    await flushPromises();
    expect(loadTargets).not.toHaveBeenCalled();
    visible.value = true;
    await flushPromises();
    expect(loadTargets).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
