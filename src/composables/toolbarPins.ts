import { computed, ref, type ComputedRef } from "vue";
import { nextToolbarPins, sanitizeToolbarPins } from "../../common/toolbarPins";
import { postConfigField } from "./postConfigField";

// Which pinned favourites the toolbar carries (#1984), hydrated from /api/config.
//
// A SINGLETON ref for the reason cockpitLines is one: the config load happens in useAppConfig
// while the toolbar that renders from it is mounted elsewhere, so a per-caller ref would leave
// the toolbar empty forever. A ref rather than a plain module value because hydration is ASYNC
// and this is read from a template — the buttons have to appear when the config arrives.
const keys = ref<string[]>([]);

export const toolbarPinKeys: ComputedRef<string[]> = computed(() => keys.value);

// How many saves this page has landed. A config GET that started BEFORE one of them answers with
// the list as it was, and hydrating that would put the promotions the user just made back the way
// they were — after which the next toggle persists the reverted list and the change is gone for
// good (CodeRabbit, PR #1991). The reader takes this mark when its request starts and hands it back
// with the answer; an answer from before a save is dropped rather than applied.
//
// Reachable because `loadConfig` RETRIES: the first read is long finished by the time a Settings
// pane opens, but a retry after a failed one is not.
let saves = 0;

/** Take before starting a read of /api/config, hand back to `setToolbarPins`. */
export const toolbarPinsMark = (): number => saves;

export const setToolbarPins = (input: unknown, mark?: number): void => {
  if (mark !== undefined && mark !== saves) return;
  keys.value = sanitizeToolbarPins(input);
};

// Mutations are SERIALIZED, and each one is expressed as an INTENT (this key, on or off) that is
// resolved against the stored list at the moment it runs — the shape `useShortcuts` uses for the
// same reason. The field is replaced whole by a partial POST, so two boxes ticked in quick
// succession would otherwise both build their list from the last CONFIRMED one and the second
// write would drop the first (Codex, PR #1991).
let chain: Promise<unknown> = Promise.resolve();

/** Promote (`promote`) or demote one pin, and persist the result.
 *
 *  `live` is what is pinned right now — the caller has it, this store does not. It is what lets a
 *  key whose pin is gone be dropped instead of holding a slot forever; an empty `live` prunes
 *  nothing (see `nextToolbarPins`).
 *
 *  False means NOTHING WAS SAVED: the request failed, or the change was refused (already there,
 *  or the cap is full). Either way the caller should show what the store says rather than what the
 *  user just clicked. */
export function promoteToolbarPin(key: string, promote: boolean, live: readonly string[]): Promise<boolean> {
  const run = chain.then(async () => {
    const next = nextToolbarPins(keys.value, live, key, promote);
    if (next === keys.value) return false;
    const r = await postConfigField("toolbarPins", [...next]);
    if (!r.ok) return false;
    saves += 1; // ...before adopting, so a read already in flight cannot undo this
    setToolbarPins(r.value);
    return true;
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
