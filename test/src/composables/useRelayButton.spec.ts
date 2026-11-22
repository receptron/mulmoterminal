import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { SlotInfo } from "../../../src/composables/readableSlot";

const live = vi.hoisted(() => ({ slots: [] as SlotInfo[], worktreeCalls: [] as string[], worktrees: [] as string[] }));

vi.mock("../../../src/composables/useTerminalConnections", () => ({ listSlots: () => live.slots }));
vi.mock("../../../src/composables/useRelayActions", () => ({
  fetchWorktreePaths: async (cwd: string) => {
    live.worktreeCalls.push(cwd);
    return live.worktrees;
  },
}));

const { useRelayButton } = await import("../../../src/composables/useRelayButton");
const { slotsVersion } = await import("../../../src/composables/slotsVersion");

const slot = (key: string, cwd: string): SlotInfo => ({ key, sessionId: `s-${key}`, agent: "codex", cwd });

// Each test's watchers live in a scope stopped after it, or an earlier test's would react to a later
// test's slot changes.
let scope: EffectScope;
const mount = (key: string, cwd: string) => {
  const partners = scope.run(() => useRelayButton(() => key, ref(cwd)));
  if (partners === undefined) throw new Error("scope stopped");
  return partners;
};

beforeEach(() => {
  live.slots = [];
  live.worktreeCalls = [];
  live.worktrees = [];
  scope = effectScope();
});
afterEach(() => scope.stop());

describe("useRelayButton", () => {
  it("follows the slot set: a partner appears when it opens and goes when it closes", async () => {
    live.slots = [slot("cell-1", "/a")];
    const partners = mount("cell-1", "/a");
    expect(partners.value).toEqual([]);

    live.slots = [slot("cell-1", "/a"), slot("cell-2", "/a")];
    slotsVersion.value++;
    await nextTick();
    expect(partners.value.map((p) => p.key)).toEqual(["cell-2"]);

    live.slots = [slot("cell-1", "/a")];
    slotsVersion.value++;
    await nextTick();
    expect(partners.value).toEqual([]);
  });

  it("asks for the worktree list only when a terminal sits elsewhere, and then pairs one in a worktree", async () => {
    live.worktrees = ["/b", "/b-wt"];
    live.slots = [slot("cell-1", "/b"), slot("cell-2", "/b")];
    const partners = mount("cell-1", "/b");
    await flushPromises();
    expect(live.worktreeCalls).toEqual([]);

    live.slots = [slot("cell-1", "/b"), slot("cell-3", "/b-wt/sub")];
    slotsVersion.value++;
    await flushPromises();
    expect(live.worktreeCalls).toEqual(["/b"]);
    expect(partners.value.map((p) => p.key)).toEqual(["cell-3"]);
  });

  it("reads one directory's worktree list once within the cache window", async () => {
    live.worktrees = ["/c"];
    live.slots = [slot("cell-1", "/c"), slot("cell-2", "/elsewhere")];
    mount("cell-1", "/c");
    mount("cell-1", "/c");
    await flushPromises();
    expect(live.worktreeCalls).toEqual(["/c"]);
  });

  it("drops the old directory's worktrees the moment the cell's directory changes", async () => {
    live.worktrees = ["/d", "/d-wt"];
    live.slots = [slot("cell-1", "/d"), slot("cell-2", "/d-wt")];
    const cwd = ref("/d");
    const partners = scope.run(() => useRelayButton(() => "cell-1", cwd));
    if (partners === undefined) throw new Error("scope stopped");
    await flushPromises();
    expect(partners.value.map((p) => p.key)).toEqual(["cell-2"]);

    live.worktrees = [];
    cwd.value = "/unrelated";
    await nextTick();
    expect(partners.value).toEqual([]);
  });

  it("asks again after an empty answer, which a failed read also gives", async () => {
    live.worktrees = [];
    live.slots = [slot("cell-1", "/e"), slot("cell-2", "/elsewhere")];
    mount("cell-1", "/e");
    await flushPromises();
    mount("cell-1", "/e");
    await flushPromises();
    expect(live.worktreeCalls).toEqual(["/e", "/e"]);
  });
});
