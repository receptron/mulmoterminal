// A chat started from a collection view shows that collection in the Canvas IMMEDIATELY, instead
// of an empty pane while the agent boots and calls presentCollection itself. The browser seeds a
// placeholder card at spawn; the agent's real result supersedes it moments later.
//
// MulmoClaude ships the same feature (its #1768) — `../mulmoclaude/src/utils/collections/
// presentSeed.ts` is the authority for the shapes and the supersede rule, and this is its
// counterpart. Two things are deliberately NOT copied, because the hosts differ:
//
//   - MulmoClaude keeps tool results in an in-memory ActiveSession and reconciles in
//     eventDispatch. Ours are stored SERVER-side (toolResultsStore, deduped by uuid) and
//     replayed per session, so the supersede has to happen on both sides — the server for what
//     is replayed after a reload, the panel for what is on screen now.
//   - its synthetic marker is client-only; ours round-trips through the store and back out of
//     /api/agent/toolResults, so the flag is part of the stored shape.
//
// In common/ because BOTH sides decide from it: the browser builds the placeholder and the
// server decides which stored card a real result replaces. Two copies of "what counts as
// synthetic" is exactly the drift this directory exists to prevent.
import { TOOL_NAME as PRESENT_COLLECTION_TOOL_NAME, type PresentCollectionData } from "@mulmoclaude/core/collection";
import { isRecord } from "./isRecord";

export { PRESENT_COLLECTION_TOOL_NAME };

export interface CollectionSlashSeed {
  slug: string;
  itemId?: string;
}

/** Parse a collection chat seed (`/<slug> …`, or `/<slug> id=<itemId> …` for one record) into the
 *  addressing a placeholder card needs. These are the shapes `skillCommandSeed` builds — a
 *  collection IS a skill, so its slug doubles as a slash command.
 *
 *  Returns null for anything else, which is what makes "no subject" fall out rather than needing a
 *  case per caller: a FEED's seed is prose (no skill behind it), and the collections index, the
 *  template cards, the Settings skill buttons and cron all send no slash command either.
 *
 *  A slug may not contain `/`, so a path-like input is not mistaken for a collection. Token-split
 *  rather than one regex, to keep away from a ReDoS-flagged pattern (same as MulmoClaude's). */
export function parseCollectionSlashSeed(message: string): CollectionSlashSeed | null {
  const trimmed = message.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const [slug, second] = trimmed.slice(1).split(/\s+/);
  if (!slug || slug.includes("/")) return null;
  const itemId = second?.startsWith("id=") ? second.slice(3) : "";
  return itemId ? { slug, itemId } : { slug };
}

/** The marker that says a card was seeded by the browser rather than called by the agent. A
 *  literal so both sides spell it the same way. */
export const SYNTHETIC_COLLECTION_KEY = "syntheticCollection";

/** Anything with a uuid. Deliberately NOT an index signature: the store's `ToolResult` has one and
 *  the panel's own interface does not, and requiring it would exclude the panel — which is half of
 *  what this file exists to keep in step. Everything else is read through `isRecord`. */
type Carded = { uuid: string };

/** The placeholder card's own shape, so a caller sees the fields it can send rather than `Carded`. */
export interface SyntheticCollectionCard extends Carded {
  toolName: string;
  message: string;
  data: PresentCollectionData;
  jsonData: PresentCollectionData;
  /** Spelled out as well as written through {@link SYNTHETIC_COLLECTION_KEY}, because a computed
   *  key is not a declaration — the interface has to name it or the literal below is excess. */
  syntheticCollection: true;
}

export const isPresentCollection = (result: unknown): boolean => isRecord(result) && result.toolName === PRESENT_COLLECTION_TOOL_NAME;

export const isSyntheticCollection = (result: unknown): boolean => isRecord(result) && result[SYNTHETIC_COLLECTION_KEY] === true;

/** Which collection a card presents. Reads `data` then `jsonData` because the tool result carries
 *  the payload in both and a partial update (a view persisting its state) may carry only one. */
export function collectionSlugOf(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  for (const field of [result.data, result.jsonData]) {
    if (isRecord(field) && typeof field.collectionSlug === "string" && field.collectionSlug) return field.collectionSlug;
  }
  return undefined;
}

/** Build the placeholder card. The payload is only the addressing — the collection View
 *  SELF-FETCHES from `collectionSlug`, so seeding needs no collection data at all, and a
 *  placeholder is never stale in the way a snapshot would be.
 *
 *  `uuid` is a parameter rather than generated here so this stays pure: the value is a caller's
 *  `crypto.randomUUID()`, and a test can pin the card without stubbing a global. */
export function makeSyntheticCollectionResult(uuid: string, collectionSlug: string, itemId?: string): SyntheticCollectionCard {
  const data: PresentCollectionData = itemId ? { collectionSlug, itemId } : { collectionSlug };
  const target = itemId ? `${collectionSlug} / ${itemId}` : collectionSlug;
  return {
    uuid,
    toolName: PRESENT_COLLECTION_TOOL_NAME,
    message: `Presented collection ${target}`,
    data,
    jsonData: data,
    [SYNTHETIC_COLLECTION_KEY]: true,
  };
}

/**
 * Fold `incoming` into `list` under the one rule that matters: a placeholder and the agent's real
 * card for the same collection are two renderings of one thing, and the real one wins. Whichever
 * arrives second — the agent can be faster than our own validation fetch.
 *
 * Returns what the caller should do with `incoming`, and MUTATES `list` to drop a superseded
 * placeholder. Both halves are needed: dropping alone would leave the real card unstored, and
 * skipping alone would leave two cards up.
 *
 * Anything that is not a presentCollection result passes straight through, so this is safe to run
 * over every result rather than only the ones a caller thinks are collections.
 */
export function reconcileCollectionCard<T extends Carded>(list: T[], incoming: unknown): "store" | "skip" {
  const slug = collectionSlugOf(incoming);
  if (!isPresentCollection(incoming) || !slug) return "store";
  const sameCollection = (candidate: T) => isPresentCollection(candidate) && collectionSlugOf(candidate) === slug;

  if (isSyntheticCollection(incoming)) {
    // The real card is already up: a placeholder now would be a stale duplicate that nothing
    // later removes, since the supersede below has already run with nothing to find.
    return list.some((candidate) => sameCollection(candidate) && !isSyntheticCollection(candidate)) ? "skip" : "store";
  }
  const index = list.findIndex((candidate) => sameCollection(candidate) && isSyntheticCollection(candidate));
  if (index >= 0) list.splice(index, 1);
  return "store";
}
