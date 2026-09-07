import { computed, ref, type ComputedRef } from "vue";
import { sanitizeToolbarPins } from "../../common/toolbarPins";
import { postConfigField } from "./postConfigField";

// Which pinned favourites the toolbar carries (#1984), hydrated from /api/config.
//
// A SINGLETON ref for the reason cockpitLines is one: the config load happens in useAppConfig
// while the toolbar that renders from it is mounted elsewhere, so a per-caller ref would leave
// the toolbar empty forever. A ref rather than a plain module value because hydration is ASYNC
// and this is read from a template — the buttons have to appear when the config arrives.
const keys = ref<string[]>([]);

export const toolbarPinKeys: ComputedRef<string[]> = computed(() => keys.value);

export const setToolbarPins = (input: unknown): void => {
  keys.value = sanitizeToolbarPins(input);
};

/** The whole list goes each time — the server replaces this key rather than merging into it. */
export async function saveToolbarPins(next: readonly string[]): Promise<boolean> {
  const r = await postConfigField("toolbarPins", [...next]);
  if (r.ok) setToolbarPins(r.value);
  return r.ok;
}
