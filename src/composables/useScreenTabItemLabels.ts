// The titles and icons of the collections and feeds open in tabs, read from the same lists their
// index pages show, per project, whenever a visit shows one of their tabs.
import { effectScope, ref, watch } from "vue";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { withProject } from "./collectionProject";
import type { PaletteScreen } from "./paletteScreens";
import {
  LIST_FIELD,
  finishedReading,
  labelIn,
  listKeyOf,
  owedAnotherRead,
  parseItemList,
  planReads,
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
  const settled = finishedReading(lists.value[request.listKey], labels);
  lists.value = { ...lists.value, [request.listKey]: settled };
  // A visit during this read saw an answer that may predate it; one more read covers that visit.
  if (settled.again) void read(request);
}

function readForVisit(shownKey: string | null): void {
  const plan = planReads(screenTabs.value, lists.value, shownKey);
  plan.owed.forEach((listKey) => {
    const list = lists.value[listKey];
    if (list) lists.value = { ...lists.value, [listKey]: owedAnotherRead(list) };
  });
  plan.read.forEach((request) => void read(request));
}

let watching = false;

/** The label of an item tab, or null until its list has named it. */
export function useScreenTabItemLabels(): { labelOf: (tab: ScreenTab) => ItemLabel | null } {
  if (!watching) {
    watching = true;
    // Detached: a watch made in the strip's setup would stop when it unmounts, and never start again.
    // It follows the tabs alone, so lists are read once per visit and never in a loop.
    effectScope(true).run(() => watch(screenTabs, () => readForVisit(frontTabKey.value), { immediate: true }));
  }
  const labelOf = (tab: ScreenTab): ItemLabel | null => (tab.item ? labelIn(lists.value[listKeyOf(tab.screen, tab.item)], tab.item.slug) : null);
  return { labelOf };
}
