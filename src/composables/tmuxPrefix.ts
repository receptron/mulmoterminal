import { computed, ref, type ComputedRef } from "vue";
import { isTmuxPrefix, TMUX_PREFIX_DEFAULT } from "../../common/tmuxPrefix";
import { postConfigField } from "./postConfigField";

// The tmux prefix key the server runs its dedicated tmux with (#2981), hydrated from /api/config so
// Settings can show it. Nothing in the browser acts on it.
const currentPrefix = ref<string>(TMUX_PREFIX_DEFAULT);

export const tmuxPrefix: ComputedRef<string> = computed(() => currentPrefix.value);

export const setTmuxPrefix = (input: unknown): void => {
  currentPrefix.value = isTmuxPrefix(input) ? input : TMUX_PREFIX_DEFAULT;
};

export async function saveTmuxPrefix(prefix: string): Promise<boolean> {
  const r = await postConfigField("tmuxPrefix", prefix);
  if (r.ok) setTmuxPrefix(r.value);
  return r.ok;
}
