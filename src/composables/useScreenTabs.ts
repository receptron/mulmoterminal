// The screens opened since the page loaded, as tabs over them: one per screen and one per collection
// or feed opened, each going back to where inside it the person was. Closing a tab only forgets it;
// what the screen holds stays.
import { computed, ref, type ComputedRef } from "vue";
import { router } from "../router";
import { returnToPlace } from "./overlayLastPlace";
import { overlayReturnPath } from "./overlayOrigin";
import { closeTab, tabOfRoute, visitTab, type ScreenTab } from "./screenTabsModel";

const tabs = ref<ScreenTab[]>([]);
router.afterEach((to) => {
  const target = tabOfRoute(to);
  if (target !== null) tabs.value = visitTab(tabs.value, target, to.fullPath);
});

export const screenTabs: ComputedRef<readonly ScreenTab[]> = computed(() => tabs.value);
/** The key of the tab in front, or null while the terminals are. */
export const frontTabKey: ComputedRef<string | null> = computed(() => tabOfRoute(router.currentRoute.value)?.key ?? null);

export function showScreenTab(key: string): void {
  const tab = tabs.value.find((candidate) => candidate.key === key);
  if (tab && key !== frontTabKey.value) void returnToPlace(tab.path);
}

export async function showTerminals(): Promise<void> {
  await router.push(overlayReturnPath());
}

/** Resolves once the screen in front has changed, if it had to. */
export async function closeScreenTab(key: string): Promise<void> {
  const { tabs: rest, next } = closeTab(tabs.value, key);
  tabs.value = rest;
  if (key !== frontTabKey.value) return;
  await (next ? returnToPlace(next.path) : showTerminals());
}
