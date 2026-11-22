// The partners the cell's own send button offers (#3399), kept live: the set of terminals changes as
// cells open, close and get their sessions, and the button must appear and disappear with it.
//
// The repo's worktree list is read once per directory and kept for a while, unlike findPartner's
// read on every press: this is evaluated on every change to the slot set, and the list is a git call
// per worktree. A stale list can only miss a worktree made in the last minute, and pressing the
// button still asks findPartner, which reads it fresh.
import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import { listSlots } from "./useTerminalConnections";
import { slotsVersion } from "./slotsVersion";
import type { SlotInfo } from "./readableSlot";
import { relayPartners } from "./relayPartners";
import { fetchWorktreePaths } from "./useRelayActions";

const WORKTREE_CACHE_MS = 60_000;
const worktreeCache = new Map<string, { at_ms: number; paths: Promise<string[]> }>();

function worktreePathsOf(cwd: string, now_ms: number): Promise<string[]> {
  const hit = worktreeCache.get(cwd);
  if (hit && now_ms - hit.at_ms < WORKTREE_CACHE_MS) return hit.paths;
  const paths = fetchWorktreePaths(cwd);
  worktreeCache.set(cwd, { at_ms: now_ms, paths });
  // An empty answer is also what a failed read gives, so it is not kept: the next change asks again.
  void paths.then((found) => {
    if (found.length === 0 && worktreeCache.get(cwd)?.paths === paths) worktreeCache.delete(cwd);
  });
  return paths;
}

/** Whether any other terminal sits outside `selfCwd`, which only the worktree list can place. */
export const someoneElsewhere = (slots: readonly SlotInfo[], selfKey: string, selfCwd: string | null): boolean =>
  selfCwd !== null && slots.some((slot) => slot.key !== selfKey && slot.cwd !== null && slot.cwd !== selfCwd);

/** `selfKey` is a getter: a cell's key follows its uid, which a grid re-parse can renumber. */
export function useRelayButton(selfKey: () => string, cwd: Ref<string | null>): ComputedRef<SlotInfo[]> {
  const worktreePaths = ref<string[]>([]);
  const slots = shallowRef<SlotInfo[]>(listSlots());
  watch(slotsVersion, () => (slots.value = listSlots()));
  const needsWorktrees = computed(() => someoneElsewhere(slots.value, selfKey(), cwd.value));
  watch(
    [needsWorktrees, cwd],
    async ([needed, dir], previous) => {
      // Another directory's worktrees would pair the wrong terminals until this one's arrive.
      if (previous && previous[1] !== dir) worktreePaths.value = [];
      if (!needed || !dir) return;
      const paths = await worktreePathsOf(dir, Date.now());
      if (cwd.value === dir) worktreePaths.value = paths;
    },
    { immediate: true },
  );
  return computed(() => relayPartners(slots.value, selfKey(), cwd.value, worktreePaths.value));
}
