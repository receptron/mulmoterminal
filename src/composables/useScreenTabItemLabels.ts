// The titles and icons of the collections and feeds open in tabs, read from the same lists their
// index pages show, per project: again when a tab names a slug not yet looked for, and when a visit
// shows an item's tab.
import { effectScope, ref, watch } from "vue";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { withProject } from "./collectionProject";
import type { PaletteScreen } from "./paletteScreens";
import {
  LIST_FIELD,
  finishedReading,
  listKeyOf,
  listsToRead,
  parseItemList,
  startedReading,
  type ItemLabel,
  type ItemList,
  type ListRequest,
} from "./screenTabItemLabels";
import type { ScreenTab } from "./screenTabsModel";
import { frontTabKey, screenTabs } from "./useScreenTabs";

const LIST_URL: Partial<Record<PaletteScreen, string>> = { collections: "/api/collections/list", feeds: "/api/feeds" };

const lists = ref<Record<string, ItemList>>({});

async function readLabels(request: ListRequest): Promise<Record<string, ItemLabel> | null> {
  const url = LIST_URL[request.screen];
  const field = LIST_FIELD[request.screen];
  if (url === undefined || field === undefined) return null;
  try {
    const response = await fetchWithTimeout(withProject(url, request.project));
    return response.ok ? parseItemList(await response.json(), field) : null;
  } catch {
    return null;
  }
}

async function read(request: ListRequest): Promise<void> {
  lists.value = { ...lists.value, [request.listKey]: startedReading(lists.value[request.listKey]) };
  const labels = await readLabels(request);
  lists.value = { ...lists.value, [request.listKey]: finishedReading(lists.value[request.listKey], request.slugs, labels) };
  // A tab opened while this list was being read was skipped; a failed read waits for the next visit.
  // Nothing counts as just shown here, or the tab in front would read its list forever.
  if (labels !== null) readWhatTabsName(null);
}

function readWhatTabsName(shownKey: string | null): void {
  listsToRead(screenTabs.value, lists.value, shownKey).forEach((request) => void read(request));
}

let watching = false;

/** The label of an item tab, or null until its list has named it. */
export function useScreenTabItemLabels(): { labelOf: (tab: ScreenTab) => ItemLabel | null } {
  if (!watching) {
    watching = true;
    // Detached: a watch made in the strip's setup would stop when it unmounts, and never start again.
    // It follows the tabs alone, so a list is read again once per visit (a rename, a failed read), never in a loop.
    effectScope(true).run(() => watch(screenTabs, () => readWhatTabsName(frontTabKey.value), { immediate: true }));
  }
  const labelOf = (tab: ScreenTab): ItemLabel | null => (tab.item ? (lists.value[listKeyOf(tab.screen, tab.item)]?.labels[tab.item.slug] ?? null) : null);
  return { labelOf };
}
