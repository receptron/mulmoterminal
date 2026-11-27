// The run view and a finished build's report: shown once every step has passed, never while a step is still
// open, and rendered from Markdown with the path it came from.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const { loadRun, loadReport, listPacks, filesGotoFile, filesGotoIndex, blueprintsViewFollowUp } = vi.hoisted(() => ({
  loadRun: vi.fn(),
  loadReport: vi.fn(),
  listPacks: vi.fn(),
  filesGotoFile: vi.fn(),
  filesGotoIndex: vi.fn(),
  blueprintsViewFollowUp: vi.fn(),
}));
vi.mock("../../../../src/composables/useBlueprintsView", () => ({ blueprintsViewFollowUp }));
vi.mock("../../../../src/composables/useFilesView", () => ({ filesGotoFile, filesGotoIndex }));
const { openTerminalAt } = vi.hoisted(() => ({ openTerminalAt: vi.fn() }));
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openTerminalAt }));
vi.mock("../../../../src/composables/blueprintsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/composables/blueprintsApi")>();
  return { ...actual, loadRun, loadReport, listPacks };
});

import BlueprintRunView from "../../../../src/components/blueprints/BlueprintRunView.vue";
import { en } from "../../../../src/i18n/en";

const step = { id: "report", title: "報告", description: "", skill: "skills/report", check: "true", gates: [], reads: [], origin: "usecase" as const };
const runView = (status: "passed" | "running" | "failed", extra: Record<string, unknown> = {}) => ({
  ok: true,
  value: {
    run: {
      id: "run-00000001",
      projectDir: "/work/docs",
      basePackDir: "/packs/docs",
      usecasePackDir: "/packs/review",
      steps: [step],
      failedChecks: {},
      activeSessionId: null,
      sessions: [],
      createdAtMs: 1,
      specChat: [],
      revisionSessionId: null,
    },
    state: { steps: { report: { status, approved: false, answers: [], ...extra } } },
  },
});

describe("a finished build's report in the run view", () => {
  beforeEach(() => {
    loadRun.mockReset();
    loadReport.mockReset();
    loadReport.mockResolvedValue({
      ok: true,
      value: {
        path: "/work/docs/.blueprint/review-report.md",
        markdown: "## 見つけたこと\n\n支払期限が二か所で違う。",
        changed: { files: ["contract.proposed.txt"], more: false },
      },
    });
  });

  it("shows the report, and where it is, once every step has passed", async () => {
    loadRun.mockResolvedValue(runView("passed"));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    const report = wrapper.get('[data-testid="blueprint-report"]');
    expect(report.text()).toContain("支払期限が二か所で違う。");
    expect(report.text()).toContain("/work/docs/.blueprint/review-report.md");
    // Inside the framed body, where the theme's text colour and font apply: bare, it rendered dark on dark.
    expect(report.get('[data-testid="blueprint-report-body"]').find("h2").exists()).toBe(true);
  });

  it("does not ask for the report while a step is still open", async () => {
    loadRun.mockResolvedValue(runView("running"));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-report"]').exists()).toBe(false);
    expect(loadReport).not.toHaveBeenCalled();
  });

  it("shows nothing when the usecase names no report", async () => {
    loadRun.mockResolvedValue(runView("passed"));
    loadReport.mockResolvedValue({ ok: true, value: { path: null, markdown: null, changed: { files: [], more: false } } });
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-report"]').exists()).toBe(false);
  });
});

describe("a step the executor stopped itself", () => {
  it("says why a repeating step stopped at its round limit in the person's language", async () => {
    loadRun.mockResolvedValue(runView("failed", { reason: "5 rounds ran and there is still work left", reasonNotice: { code: "round-limit", rounds: 5 } }));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-stop-reason"]').text()).toBe(en.blueprints.notices.roundLimit.replace("{rounds}", "5"));
  });

  it("shows a person's own reason as they wrote it", async () => {
    loadRun.mockResolvedValue(runView("failed", { reason: "予算が足りない" }));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-stop-reason"]').text()).toBe("予算が足りない");
  });

  it("says why in the person's language, not in the English kept for the agent", async () => {
    const lastCheck = { ok: false, output: "Another build (run-00000002) is working", atMs: 1, notice: { code: "folder-busy", runId: "run-00000002" } };
    loadRun.mockResolvedValue(runView("failed", { lastCheck, reason: "check failed" }));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-check-output"]').text()).toBe(en.blueprints.notices.folderBusy.replace("{runId}", "run-00000002"));
  });
});

describe("the files a finished build wrote", () => {
  const finishedWith = (changed: { files: string[]; more: boolean }) => {
    loadRun.mockResolvedValue(runView("passed"));
    loadReport.mockResolvedValue({ ok: true, value: { path: null, markdown: null, changed } });
  };

  it("opens each one, and the folder, in the Files view rooted at the build's folder", async () => {
    finishedWith({ files: ["contract.proposed.txt", "notes/summary.md"], more: false });
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    const buttons = wrapper.findAll('[data-testid="blueprint-changed-file"]');
    expect(buttons.map((button) => button.text())).toEqual(["descriptioncontract.proposed.txt", "descriptionnotes/summary.md"]);
    await buttons[1]?.trigger("click");
    expect(filesGotoFile).toHaveBeenLastCalledWith("/work/docs", "notes/summary.md");
    await wrapper.get('[data-testid="blueprint-open-folder"]').trigger("click");
    expect(filesGotoIndex).toHaveBeenLastCalledWith("/work/docs");
    expect(wrapper.text()).not.toContain(en.blueprints.run.changedMore);
  });

  it("says when nothing was written, and when more was written than it lists", async () => {
    finishedWith({ files: [], more: false });
    const none = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(none.get('[data-testid="blueprint-changed"]').text()).toContain(en.blueprints.run.changedNone);
    finishedWith({ files: ["a.md"], more: true });
    const more = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(more.get('[data-testid="blueprint-changed"]').text()).toContain(en.blueprints.run.changedMore);
    finishedWith({ files: [], more: true });
    const unread = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(unread.get('[data-testid="blueprint-changed"]').text()).toContain(en.blueprints.run.changedMore);
    expect(unread.get('[data-testid="blueprint-changed"]').text()).not.toContain(en.blueprints.run.changedNone);
  });

  it("is not shown while a step is still open", async () => {
    loadRun.mockResolvedValue(runView("running"));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-changed"]').exists()).toBe(false);
  });
});

describe("what a finished build may go on to", () => {
  const packs = {
    ok: true,
    value: {
      packs: [
        {
          slug: "docs",
          manifest: { kind: "base", slug: "docs", title: "文書のフォルダ", version: "1", description: "", platform: "local", requires: [], credentials: [] },
        },
        {
          slug: "style",
          manifest: {
            kind: "usecase",
            slug: "style",
            title: "規約をつくる",
            version: "1",
            description: "",
            bases: ["docs"],
            next: [{ usecase: "write", answers: { style: "folder" }, carry: { audience: "audience" }, changedFilesTo: "sources" }],
          },
        },
        { slug: "write", manifest: { kind: "usecase", slug: "write", title: "文書を書く", version: "1", description: "", bases: ["docs"], next: [] } },
      ],
    },
  };
  const finishedWith = (pair: { base: string; usecase: string } | null, language: string | null = null) => {
    listPacks.mockResolvedValue(packs);
    const finished = runView("passed");
    loadRun.mockResolvedValue({
      ...finished,
      value: { ...finished.value, run: { ...finished.value.run, answers: { audience: "新しく入った人", kind: "記事" }, language } },
    });
    loadReport.mockResolvedValue({ ok: true, value: { path: null, markdown: null, changed: { files: ["STYLE.md", "chaff.yaml"], more: false }, pair } });
  };

  it("offers the next step, and opens it with the same base and folder, its answers, the ones it carries and the files the build changed, and what it continues", async () => {
    finishedWith({ base: "docs", usecase: "style" });
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    const button = wrapper.get('[data-testid="blueprint-next-step"]');
    expect(button.text()).toContain("文書を書く");
    await button.trigger("click");
    expect(blueprintsViewFollowUp).toHaveBeenCalledWith({
      base: "docs",
      usecase: "write",
      answers: { audience: "新しく入った人", sources: "STYLE.md\nchaff.yaml", style: "folder" },
      projectDir: "/work/docs",
      after: "規約をつくる",
    });
  });

  it("keeps the finished build's report language for the next one", async () => {
    finishedWith({ base: "docs", usecase: "style" }, "ja");
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-next-step"]').trigger("click");
    expect(blueprintsViewFollowUp).toHaveBeenCalledWith(expect.objectContaining({ usecase: "write", language: "ja" }));
  });

  it("offers nothing when the report does not say which packs ran", async () => {
    finishedWith(null);
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-next-steps"]').exists()).toBe(false);
  });
});

describe("a review gate", () => {
  const gated = (reads: string[]) => {
    const reviewStep = { ...step, id: "propose", gates: ["review"], reads };
    const view = runView("passed");
    return {
      ...view,
      value: {
        ...view.value,
        run: { ...view.value.run, steps: [reviewStep] },
        state: { steps: { propose: { status: "awaiting-approval", approved: false, answers: [] } } },
      },
    };
  };

  // The gate stands before the step it names: without the name, the step's own title above read as work already done.
  it("says which step the approval lets start", async () => {
    loadRun.mockResolvedValue(gated([".blueprint/brief.md"]));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    const gate = wrapper.get('[data-testid="blueprint-current"] li').text();
    expect(gate).toContain("報告");
    expect(gate).not.toMatch(/[{}]/);
  });

  it("lists what to read before approving, each opening in the Files view", async () => {
    loadRun.mockResolvedValue(gated([".blueprint/findings.json", "STYLE.md"]));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    const files = wrapper.findAll('[data-testid="blueprint-read-file"]');
    expect(files.map((file) => file.text())).toEqual(["description.blueprint/findings.json", "descriptionSTYLE.md"]);
    await files[1]?.trigger("click");
    expect(filesGotoFile).toHaveBeenLastCalledWith("/work/docs", "STYLE.md");
    // The icon is decoration: a screen reader should hear the file name, not "description".
    expect(files.every((file) => file.get(".material-symbols-outlined").attributes("aria-hidden") === "true")).toBe(true);
  });

  it("lists nothing when the step names nothing to read, and asks the spec panel to stay: that is an app build's gate", async () => {
    loadRun.mockResolvedValue(gated([]));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-reads"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: "BlueprintSpecReview" }).props("expectsSpec")).toBe(true);
  });

  it("does not ask the spec panel to stay at a gate that names what to read", async () => {
    loadRun.mockResolvedValue(gated(["STYLE.md"]));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.findComponent({ name: "BlueprintSpecReview" }).props("expectsSpec")).toBe(false);
  });
});

describe("a step stopped because Claude Code does not trust the folder", () => {
  const lastCheck = (notice: Record<string, unknown>) => ({ ok: false, output: "English", atMs: 1, notice });

  beforeEach(() => {
    loadRun.mockReset();
    loadReport.mockReset();
    openTerminalAt.mockReset();
  });

  it("opens Claude Code in that folder for the person to answer, and still offers Try again", async () => {
    loadRun.mockResolvedValue(runView("failed", { lastCheck: lastCheck({ code: "untrusted", dir: "/work/docs" }) }));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-run-trust"]').text()).toContain("/work/docs");
    await wrapper.get('[data-testid="blueprint-run-open-trust"]').trigger("click");
    expect(openTerminalAt).toHaveBeenCalledWith("/work/docs", null, "claude");
    expect(wrapper.find('[data-testid="blueprint-retry"]').exists()).toBe(true);
  });

  it("offers nothing to open when the step stopped for another reason", async () => {
    loadRun.mockResolvedValue(runView("failed", { lastCheck: lastCheck({ code: "session-lost" }) }));
    const wrapper = mount(BlueprintRunView, { props: { runId: "run-00000001" } });
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-run-open-trust"]').exists()).toBe(false);
  });
});

// The Blueprints screen is kept while closed: a report that could not be read is asked for again when shown.
describe("the report shown again", () => {
  it("is asked for again when it could not be read, and not once it was", async () => {
    loadRun.mockReset();
    loadRun.mockResolvedValue(runView("passed"));
    listPacks.mockResolvedValue({ ok: true, value: { packs: [] } });
    const good = { ok: true, value: { path: "/work/docs/.blueprint/review-report.md", markdown: "## found", changed: { files: [], more: false } } };
    loadReport.mockReset();
    loadReport.mockResolvedValueOnce({ ok: false, error: "busy" }).mockResolvedValue(good);
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintRunView, { runId: "run-00000001" });
    await flushPromises();
    await showAgain();
    expect(loadReport).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("found");
    await showAgain();
    expect(loadReport).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
