// What an item tab is called: the title and icon its screen's own list gives that slug, read from
// the list response, and which lists still have to be read for the tabs open.
import { isRecord } from "../../common/isRecord";
import type { PaletteScreen } from "./paletteScreens";
import type { ScreenItem, ScreenTab } from "./screenTabsModel";

export interface ItemLabel {
  title: string;
  icon: string;
}

/** One list as read so far: the labels it gave, and every slug a read was made to find. */
export interface ItemList {
  labels: Readonly<Record<string, ItemLabel>>;
  lookedFor: ReadonlySet<string>;
  reading: boolean;
}

export interface ListRequest {
  listKey: string;
  screen: PaletteScreen;
  project: string | null;
  slugs: string[];
}

// The array each list endpoint answers with.
export const LIST_FIELD: Partial<Record<PaletteScreen, string>> = { collections: "collections", feeds: "feeds" };

/** One list per screen and project: the same slug in two projects names two different things. */
export const listKeyOf = (screen: PaletteScreen, item: ScreenItem): string => `${screen}\n${item.project ?? ""}`;

const toLabel = (entry: unknown): [string, ItemLabel] | null => {
  if (!isRecord(entry) || typeof entry.slug !== "string" || typeof entry.title !== "string") return null;
  return [entry.slug, { title: entry.title, icon: typeof entry.icon === "string" ? entry.icon : "" }];
};

/** The labels a list response holds, by slug; nothing for a body that is not that list. */
export function parseItemList(body: unknown, field: string): Record<string, ItemLabel> {
  const entries = isRecord(body) && Array.isArray(body[field]) ? body[field] : [];
  return Object.fromEntries(entries.map(toLabel).filter((pair) => pair !== null));
}

// A slug a read already looked for and did not find stays unnamed rather than being asked for forever.
const wanted = (list: ItemList | undefined, slug: string): boolean =>
  list === undefined || (!list.reading && !(slug in list.labels) && !list.lookedFor.has(slug));

/** The lists to read now for `tabs`, each with every slug it is read to find. */
export function listsToRead(tabs: readonly ScreenTab[], lists: Readonly<Record<string, ItemList>>): ListRequest[] {
  const requests = new Map<string, ListRequest>();
  tabs.forEach(({ screen, item }) => {
    if (item === null || LIST_FIELD[screen] === undefined) return;
    const listKey = listKeyOf(screen, item);
    if (!wanted(lists[listKey], item.slug)) return;
    const request = requests.get(listKey) ?? { listKey, screen, project: item.project, slugs: [] };
    requests.set(listKey, { ...request, slugs: [...request.slugs, item.slug] });
  });
  return [...requests.values()];
}
