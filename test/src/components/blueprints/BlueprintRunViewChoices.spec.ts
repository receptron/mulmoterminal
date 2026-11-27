// A question that offers choices: one button each, the recommended one marked, and a free answer still possible.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { StepState } from "../../../../common/blueprint/state";

const { loadRun, loadReport, sendEvent } = vi.hoisted(() => ({ loadRun: vi.fn(), loadReport: vi.fn(), sendEvent: vi.fn() }));
vi.mock("../../../../src/composables/useBlueprintsView", () => ({ blueprintsViewFollowUp: vi.fn() }));
vi.mock("../../../../src/composables/useFilesView", () => ({ filesGotoFile: vi.fn(), filesGotoIndex: vi.fn() }));
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openTerminalAt: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/composables/blueprintsApi")>();
  return { ...actual, loadRun, loadReport, sendEvent };
});

const BlueprintRunView = (await import("../../../../src/components/blueprints/BlueprintRunView.vue")).default;

const step = { id: "tranche", title: "一件", description: "", skill: "skills/tranche", check: "true", gates: [], reads: [], origin: "usecase" as const };
const runView = (stepState: StepState) => ({
  ok: true,
  value: {
    run: {
      id: "run-00000001",
      projectDir: "/work/app",
      basePackDir: "/packs/repo",
      usecasePackDir: "/packs/refactor",
      steps: [step],
      failedChecks: {},
      activeSessionId: null,
      sessions: [],
      createdAtMs: 1,
      specChat: [],
      revisionSessionId: null,
      archivedAtMs: null,
    },
    state: { steps: { tranche: stepState } },
  },
});

const asking = (choices?: StepState["choices"]): StepState => ({ status: "awaiting-answer", approved: false, answers: [], question: "Fix the type?", choices });

const mountView = async () => {
  const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
  await flushPromises();
  return wrapper;
};

describe("answering a question that offers choices", () => {
  beforeEach(() => {
    loadRun.mockReset();
    sendEvent.mockReset();
    loadReport.mockResolvedValue({ ok: true, value: { path: null, markdown: null, changed: { files: [], more: false }, pair: null } });
  });

  it("shows each choice with its cost, marks only the recommended one, and answers with the label", async () => {
    loadRun.mockResolvedValue(
      runView(
        asking([
          { label: "Fix", description: "types only, runtime unaffected" },
          { label: "Leave", description: "costs nothing", recommended: true },
        ]),
      ),
    );
    sendEvent.mockResolvedValue(runView({ status: "running", approved: false, answers: [] }));
    const wrapper = await mountView();
    const buttons = wrapper.findAll('[data-testid="blueprint-choice"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text()).toContain("types only, runtime unaffected");
    expect(buttons[1].text()).toContain("costs nothing");
    expect(buttons[0].find('[data-testid="blueprint-choice-recommended"]').exists()).toBe(false);
    expect(buttons[1].find('[data-testid="blueprint-choice-recommended"]').exists()).toBe(true);
    await buttons[1].trigger("click");
    await flushPromises();
    expect(sendEvent).toHaveBeenCalledWith("run-00000001", "tranche", { type: "answer", answer: "Leave" });
    wrapper.unmount();
  });

  it("keeps the free answer beside the choices", async () => {
    loadRun.mockResolvedValue(runView(asking([{ label: "Fix" }, { label: "Leave" }])));
    const wrapper = await mountView();
    expect(wrapper.find('[data-testid="blueprint-answer"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it.each([undefined, []])("shows no choice buttons for a plain question: %j", async (choices) => {
    loadRun.mockResolvedValue(runView(asking(choices)));
    const wrapper = await mountView();
    expect(wrapper.find('[data-testid="blueprint-choices"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="blueprint-answer"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

// What was typed answers the step it was typed for, so it goes when the build moves on.
describe("an answer typed before the build moved on", () => {
  it("is cleared when the step's state changes, and kept while it does not", async () => {
    vi.useFakeTimers();
    loadRun.mockReset();
    loadRun.mockResolvedValue(runView(asking()));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-answer"]').setValue("yes, fix it");
    await vi.advanceTimersByTimeAsync(2000); // the same question again
    expect(wrapper.get<HTMLTextAreaElement>('[data-testid="blueprint-answer"]').element.value).toBe("yes, fix it");
    loadRun.mockResolvedValue(runView({ status: "running", approved: false, answers: [] }));
    await vi.advanceTimersByTimeAsync(2000);
    loadRun.mockResolvedValue(runView(asking()));
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.get<HTMLTextAreaElement>('[data-testid="blueprint-answer"]').element.value).toBe("");
    vi.useRealTimers();
    wrapper.unmount();
  });

  it("is cleared when the question is asked again in other words, or the next round asks, with the status unchanged", async () => {
    vi.useFakeTimers();
    loadRun.mockReset();
    loadRun.mockResolvedValue(runView(asking()));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    const typed = () => wrapper.get<HTMLTextAreaElement>('[data-testid="blueprint-answer"]').element.value;
    await wrapper.get('[data-testid="blueprint-answer"]').setValue("yes, fix it");
    loadRun.mockResolvedValue(runView({ ...asking(), question: "Fix the type, or rename it?" }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(typed()).toBe("");
    await wrapper.get('[data-testid="blueprint-answer"]').setValue("rename it");
    loadRun.mockResolvedValue(runView({ ...asking(), question: "Fix the type, or rename it?", round: 2 }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(typed()).toBe("");
    vi.useRealTimers();
    wrapper.unmount();
  });
});
