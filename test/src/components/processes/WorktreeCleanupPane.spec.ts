// The worktree list: reads that finish out of order must not put back a worktree just removed, and
// blocked worktrees are listed by default with what holds them.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";
import type { WorktreeCleanupRow } from "../../../../common/worktreeCleanup";

const api = vi.hoisted(() => ({ reads: [] as ((rows: WorktreeCleanupRow[] | null) => void)[] }));
vi.mock("../../../../src/composables/processesApi", () => ({
  loadWorktreeCleanup: () => new Promise((resolve) => api.reads.push(resolve)),
  removeCleanupWorktree: async () => true,
}));

const WorktreeCleanupPane = (await import("../../../../src/components/processes/WorktreeCleanupPane.vue")).default;

const row = (name: string, extra: Partial<WorktreeCleanupRow> = {}): WorktreeCleanupRow => ({
  repo: "/r",
  base: "main",
  path: `/wt/${name}`,
  branch: `agent/${name}`,
  head: "abc",
  ignored: [],
  ignoredCount: 0,
  exists: true,
  dirty: false,
  merged: true,
  inUse: false,
  ...extra,
});

beforeEach(() => {
  api.reads = [];
});

describe("WorktreeCleanupPane", () => {
  it("keeps the latest read when an earlier one finishes after it", async () => {
    const wrapper = mount(WorktreeCleanupPane);
    await wrapper.get("[data-testid=worktrees-refresh]").trigger("click");
    const [first, second] = api.reads;
    second?.([row("fresh")]);
    await flushPromises();
    first?.([row("fresh"), row("removed")]);
    await flushPromises();
    expect(wrapper.findAll("[data-testid=worktrees-row]").map((r) => r.text())).toEqual([expect.stringContaining("/wt/fresh")]);
  });

  it("lists a blocked worktree by default, with what holds it, and offers no Remove for it", async () => {
    const wrapper = mount(WorktreeCleanupPane);
    api.reads[0]?.([row("ok"), row("busy", { dirty: true })]);
    await flushPromises();
    expect(wrapper.findAll("[data-testid=worktrees-row]")).toHaveLength(2);
    expect(wrapper.findAll("[data-testid=worktrees-blocker]")).toHaveLength(1);
    expect(wrapper.findAll("[data-testid=worktrees-remove]")).toHaveLength(1);
  });
});

describe("WorktreeCleanupPane and ignored files", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the ignored files on the row and in the confirmation, with how many more", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(WorktreeCleanupPane);
    api.reads[0]?.([row("env", { ignored: [".env", "node_modules/"], ignoredCount: 5 })]);
    await flushPromises();
    expect(wrapper.get("[data-testid=worktrees-ignored]").text()).toContain(".env, node_modules/");
    await wrapper.get("[data-testid=worktrees-remove]").trigger("click");
    const asked = String(confirm.mock.calls[0]?.[0]);
    expect(asked).toContain(".env, node_modules/");
    expect(asked).toContain("3");
  });

  it("asks without an ignored-files line when there are none", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(WorktreeCleanupPane);
    api.reads[0]?.([row("plain")]);
    await flushPromises();
    expect(wrapper.find("[data-testid=worktrees-ignored]").exists()).toBe(false);
    await wrapper.get("[data-testid=worktrees-remove]").trigger("click");
    expect(String(confirm.mock.calls[0]?.[0])).not.toContain("gitignore");
  });
});

describe("the worktree list shown again", () => {
  it("keeps the list under the failure when the re-read fails", async () => {
    const { wrapper, showAgain } = mountUnderOverlay(WorktreeCleanupPane, {});
    api.reads[0]?.([row("kept")]);
    await flushPromises();
    const shown = showAgain();
    await flushPromises();
    api.reads.at(-1)?.(null);
    await shown;
    await flushPromises();
    expect(wrapper.findAll("[data-testid=worktrees-row]")).toHaveLength(1);
    wrapper.unmount();
  });
});
