// What an item tab is called, and which lists a visit reads. Stated as when a read IS made — a visit
// shows one of the list's tabs, or the list never answered — and an answer replaces the last one, so a
// rename, an addition and a deletion all arrive through the same read.
import { isRecord } from "../../common/isRecord";
import type { PaletteScreen } from "./paletteScreens";
import type { ScreenItem, ScreenTab } from "./screenTabsModel";

export interface ItemLabel {
  title: string;
  icon: string;
}

/** One list: its last answer (null until one arrives), whether a read is in flight, and whether a
 *  visit asked for it during that read and so is owed one more. */
export interface ItemList {
  labels: Readonly<Record<string, ItemLabel>> | null;
  reading: boolean;
  again: boolean;
}

export interface ListRequest {
  listKey: string;
  screen: PaletteScreen;
  project: string | null;
}

export interface ReadPlan {
  read: ListRequest[];
  owed: string[];
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

/** What the list's last answer calls `slug`; only the answer's own entries count, so a slug such as
 *  `constructor` does not read the object's prototype. */
export const labelIn = (list: ItemList | undefined, slug: string): ItemLabel | null =>
  list?.labels && Object.hasOwn(list.labels, slug) ? (list.labels[slug] ?? null) : null;

/** A list while a read of it is in flight. */
export const startedReading = (before: ItemList | undefined): ItemList => ({ labels: before?.labels ?? null, reading: true, again: false });

/** A list after its read answered `labels`, or failed (null) and so keeps its last answer. */
export const finishedReading = (before: ItemList | undefined, labels: Record<string, ItemLabel> | null): ItemList => ({
  labels: labels ?? before?.labels ?? null,
  reading: false,
  again: before?.again ?? false,
});

/** A list a visit asked for while it was being read. */
export const owedAnotherRead = (before: ItemList): ItemList => ({ ...before, again: true });

/** For a visit that put `shownKey` in front: the lists to read now, and the ones already being read
 *  that it asked for, which are owed one more read when the current one settles. */
export function planReads(tabs: readonly ScreenTab[], lists: Readonly<Record<string, ItemList>>, shownKey: string | null): ReadPlan {
  const read = new Map<string, ListRequest>();
  const owed = new Set<string>();
  tabs.forEach(({ key, screen, item }) => {
    if (item === null || LIST_FIELD[screen] === undefined) return;
    const listKey = listKeyOf(screen, item);
    const list = lists[listKey];
    if (key !== shownKey && list?.labels) return;
    if (list?.reading) owed.add(listKey);
    else read.set(listKey, { listKey, screen, project: item.project });
  });
  return { read: [...read.values()], owed: [...owed] };
}
