// The screens opened since the page loaded, as tabs over them: one per screen, each going back to
// where inside it the person was. Closing a tab only forgets it; what the screen holds stays.
import { computed, ref, type ComputedRef } from "vue";
import { router } from "../router";
import { returnToPlace } from "./overlayLastPlace";
import { overlayReturnPath } from "./overlayOrigin";
import type { PaletteScreen } from "./paletteScreens";
import { closeTab, screenOfRoute, visitTab, type ScreenTab } from "./screenTabsModel";

const tabs = ref<ScreenTab[]>([]);
router.afterEach((to) => {
  const screen = screenOfRoute(to.name);
  if (screen !== null) tabs.value = visitTab(tabs.value, screen, to.fullPath);
});

export const screenTabs: ComputedRef<readonly ScreenTab[]> = computed(() => tabs.value);
export const frontScreen: ComputedRef<PaletteScreen | null> = computed(() => screenOfRoute(router.currentRoute.value.name));

export function showScreenTab(screen: PaletteScreen): void {
  const tab = tabs.value.find((candidate) => candidate.screen === screen);
  if (tab && screen !== frontScreen.value) void returnToPlace(tab.path);
}

export async function showTerminals(): Promise<void> {
  await router.push(overlayReturnPath());
}

/** Resolves once the screen in front has changed, if it had to. */
export async function closeScreenTab(screen: PaletteScreen): Promise<void> {
  const { tabs: rest, next } = closeTab(tabs.value, screen);
  tabs.value = rest;
  if (screen !== frontScreen.value) return;
  await (next ? returnToPlace(next.path) : showTerminals());
}
