// The titles and icons of the collections and feeds open in tabs, read from the same lists their
// index pages show, per project, and again only when a tab names a slug not yet looked for.
import { effectScope, ref, watch } from "vue";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { withProject } from "./collectionProject";
import type { PaletteScreen } from "./paletteScreens";
import { LIST_FIELD, listKeyOf, listsToRead, parseItemList, type ItemLabel, type ItemList, type ListRequest } from "./screenTabItemLabels";
import type { ScreenTab } from "./screenTabsModel";
import { screenTabs } from "./useScreenTabs";

const LIST_URL: Partial<Record<PaletteScreen, string>> = { collections: "/api/collections/list", feeds: "/api/feeds" };

const lists = ref<Record<string, ItemList>>({});

async function readLabels(request: ListRequest): Promise<Record<string, ItemLabel>> {
  const url = LIST_URL[request.screen];
  const field = LIST_FIELD[request.screen];
  if (url === undefined || field === undefined) return {};
  try {
    const response = await fetchWithTimeout(withProject(url, request.project));
    return response.ok ? parseItemList(await response.json(), field) : {};
  } catch {
    return {};
  }
}

async function read(request: ListRequest): Promise<void> {
  const before = lists.value[request.listKey];
  const lookedFor = new Set([...(before?.lookedFor ?? []), ...request.slugs]);
  lists.value = { ...lists.value, [request.listKey]: { labels: before?.labels ?? {}, lookedFor, reading: true } };
  const labels = await readLabels(request);
  lists.value = { ...lists.value, [request.listKey]: { labels: { ...before?.labels, ...labels }, lookedFor, reading: false } };
}

let watching = false;

/** The label of an item tab, or null until its list has named it. */
export function useScreenTabItemLabels(): { labelOf: (tab: ScreenTab) => ItemLabel | null } {
  if (!watching) {
    watching = true;
    // Detached: a watch made in the strip's setup would stop when it unmounts, and never start again.
    effectScope(true).run(() =>
      watch([screenTabs, lists], () => listsToRead(screenTabs.value, lists.value).forEach((request) => void read(request)), { immediate: true }),
    );
  }
  const labelOf = (tab: ScreenTab): ItemLabel | null => (tab.item ? (lists.value[listKeyOf(tab.screen, tab.item)]?.labels[tab.item.slug] ?? null) : null);
  return { labelOf };
}
