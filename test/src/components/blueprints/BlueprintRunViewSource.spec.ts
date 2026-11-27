// The run view says so when the source a build copied has changed since: asked once when the build is shown, not on
// every poll, and said only when it changed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const { loadRun, loadReport, loadRunSource } = vi.hoisted(() => ({ loadRun: vi.fn(), loadReport: vi.fn(), loadRunSource: vi.fn() }));
vi.mock("../../../../src/composables/useBlueprintsView", () => ({ blueprintsViewFollowUp: vi.fn() }));
vi.mock("../../../../src/composables/useFilesView", () => ({ filesGotoFile: vi.fn(), filesGotoIndex: vi.fn() }));
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openTerminalAt: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/composables/blueprintsApi")>();
  return { ...actual, loadRun, loadReport, loadRunSource };
});

const BlueprintRunView = (await import("../../../../src/components/blueprints/BlueprintRunView.vue")).default;

const step = { id: "spec", title: "仕様書", description: "", skill: "skills/spec", check: "true", gates: [], reads: [], origin: "usecase" as const };
const runView = {
  ok: true,
  value: {
    run: {
      id: "run-00000001",
      projectDir: "/work/app",
      basePackDir: "/packs/local",
      usecasePackDir: "/packs/from-collection",
      steps: [step],
      failedChecks: {},
      activeSessionId: null,
      sessions: [],
      createdAtMs: 1,
      specChat: [],
      revisionSessionId: null,
    },
    state: { steps: { spec: { status: "running", approved: false, answers: [] } } },
  },
};

describe("the run view and a source that changed", () => {
  beforeEach(() => {
    loadRun.mockReset();
    loadRun.mockResolvedValue(runView);
    loadReport.mockReset();
    loadRunSource.mockReset();
  });

  it("says the source changed after the copy, and asks once however often the build is read", async () => {
    loadRunSource.mockResolvedValue({ ok: true, value: { status: "changed", takenAt: "2026-09-29T00:00:00.000Z" } });
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-source-changed"]').text()).toContain("The source has changed since its copy was taken");
    expect(loadRunSource).toHaveBeenCalledTimes(1);
    expect(loadRunSource).toHaveBeenCalledWith("run-00000001");
    wrapper.unmount();
  });

  it.each([
    { ok: true, value: { status: "same" } },
    { ok: true, value: { status: "unknown" } },
    { ok: true, value: { status: "unreadable", reason: "signed-out" } },
    { ok: false, error: "no blueprint run" },
  ])("says nothing for %j", async (answer) => {
    loadRunSource.mockResolvedValue(answer);
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-source-changed"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("asks again for another build, and drops what it said about the last one", async () => {
    loadRunSource.mockResolvedValueOnce({ ok: true, value: { status: "changed", takenAt: "2026-09-29T00:00:00.000Z" } });
    loadRunSource.mockResolvedValueOnce({ ok: true, value: { status: "same" } });
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    await wrapper.setProps({ runId: "run-00000002" });
    await flushPromises();
    expect(loadRunSource).toHaveBeenLastCalledWith("run-00000002");
    expect(wrapper.find('[data-testid="blueprint-source-changed"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

// The Blueprints screen is kept while closed; showing it again shows the build again, which asks again.
describe("the source shown again", () => {
  it("is asked about again each time the screen is shown, and the notice follows the answer", async () => {
    loadRun.mockReset();
    loadRun.mockResolvedValue(runView);
    loadRunSource.mockReset();
    loadRunSource
      .mockResolvedValueOnce({ ok: true, value: { status: "same" } })
      .mockResolvedValue({ ok: true, value: { status: "changed", takenAt: "2026-09-29T00:00:00.000Z" } });
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintRunView, { runId: "run-00000001" });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-source-changed"]').exists()).toBe(false);
    await showAgain();
    expect(loadRunSource).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="blueprint-source-changed"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
