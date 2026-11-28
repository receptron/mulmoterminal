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

/** The labels a list response holds, by slug; null for a body that is not that list, so a broken
 *  answer is not mistaken for a list that names nothing. */
export function parseItemList(body: unknown, field: string): Record<string, ItemLabel> | null {
  if (!isRecord(body) || !Array.isArray(body[field])) return null;
  return Object.fromEntries(body[field].map(toLabel).filter((pair) => pair !== null));
}

/** A list while a read of it is in flight. */
export const startedReading = (before: ItemList | undefined): ItemList => ({
  labels: before?.labels ?? {},
  lookedFor: before?.lookedFor ?? new Set(),
  reading: true,
});

/** A list after a read for `slugs` answered `labels`, or failed (null). Only an answer marks the
 *  slugs as looked for: a failed read is tried again on the next visit, not given up on. */
export function finishedReading(before: ItemList | undefined, slugs: readonly string[], labels: Record<string, ItemLabel> | null): ItemList {
  const settled = startedReading(before);
  if (labels === null) return { ...settled, reading: false };
  return { labels: { ...settled.labels, ...labels }, lookedFor: new Set([...settled.lookedFor, ...slugs]), reading: false };
}

// A slug a read already looked for and did not find stays unnamed rather than being asked for forever,
// except in the tab just shown: reading its list again there is what picks up a rename.
const wanted = (list: ItemList | undefined, slug: string, shown: boolean): boolean =>
  list === undefined || (!list.reading && (shown || (!(slug in list.labels) && !list.lookedFor.has(slug))));

/** The lists to read now for `tabs`, each with every slug it is read to find. `shownKey` is the tab
 *  a visit just put in front, whose list is read again whatever was read before. */
export function listsToRead(tabs: readonly ScreenTab[], lists: Readonly<Record<string, ItemList>>, shownKey: string | null): ListRequest[] {
  const requests = new Map<string, ListRequest>();
  tabs.forEach(({ key, screen, item }) => {
    if (item === null || LIST_FIELD[screen] === undefined) return;
    const listKey = listKeyOf(screen, item);
    if (!wanted(lists[listKey], item.slug, key === shownKey)) return;
    const request = requests.get(listKey) ?? { listKey, screen, project: item.project, slugs: [] };
    requests.set(listKey, { ...request, slugs: [...request.slugs, item.slug] });
  });
  return [...requests.values()];
}
