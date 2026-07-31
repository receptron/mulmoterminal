// Show the collection in the new chat's Canvas the moment the chat is placed, instead of an empty
// pane for as long as the agent takes to boot and call presentCollection itself. The card is a
// placeholder with the same render contract as the real one — the View self-fetches from the slug
// — and the agent's own result supersedes it (see common/collectionSeed.ts).
//
// MulmoClaude's counterpart is `seedCollectionPresentation` in its App.vue (#1768). The subject
// comes from the SEED PROMPT rather than from whatever screen the user was on, which is what makes
// it work here: placing a spawned chat can navigate to /terminals, and useCollectionBrowse drops
// the open record on any path change — so route-derived state is already gone by the time a spawn
// resolves. The prompt travels with the chat.
import { parseCollectionSlashSeed, makeSyntheticCollectionResult } from "../../common/collectionSeed";

interface CollectionsListResponse {
  collections?: { slug?: unknown }[];
}

/** Does `slug` name a real collection? Asked before seeding so a NON-collection slash command
 *  (`/deep-research`, a typo) does not flash a "collection not found" card. A failed request
 *  answers no: the agent still presents the collection a moment later, so the cost of skipping is
 *  a slower first paint, while the cost of guessing wrong is a visible error. */
async function isKnownCollection(slug: string): Promise<boolean> {
  try {
    const res = await fetch("/api/collections/list");
    if (!res.ok) return false;
    const body = (await res.json()) as CollectionsListResponse;
    return Array.isArray(body.collections) && body.collections.some((entry) => entry?.slug === slug);
  } catch {
    return false;
  }
}

/**
 * Seed `sessionId`'s Canvas with the collection `prompt` addresses, if it addresses one.
 *
 * No-op for every other kind of chat, and that is the point of parsing the prompt rather than
 * branching per caller: a feed's seed is prose, and the collections index, the new-collection
 * template cards, the Settings skill buttons and cron all send no slash command at all.
 *
 * Returns whether a card was seeded. The caller needs the answer to decide whether to REVEAL the
 * Canvas: enlarging a cell and opening the pane is right when there is a collection waiting in it
 * and intrusive when there is not, and this is the only place that knows which.
 *
 * A failure costs the head start and nothing else — the agent presents the collection itself a
 * moment later — so it is logged and reported as "not seeded" rather than surfaced.
 */
export async function seedCollectionCanvas(sessionId: string, prompt: string): Promise<boolean> {
  const seed = parseCollectionSlashSeed(prompt);
  if (!seed) return false;
  if (!(await isKnownCollection(seed.slug))) return false;
  // The race where the agent's real card beats this one is settled SERVER-side, in
  // storeToolResult: it holds the list both writers append to, so it is the only place that can
  // compare them without a check-then-act gap. MulmoClaude asks its own session first because its
  // results live in the browser.
  const card = makeSyntheticCollectionResult(crypto.randomUUID(), seed.slug, seed.itemId);
  try {
    const res = await fetch("/api/agent/toolResult", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...card, sessionId }),
    });
    if (res.ok) return true;
    console.error(`[seedCollectionCanvas] HTTP ${res.status}`);
  } catch (err) {
    console.error("[seedCollectionCanvas] failed", err);
  }
  return false;
}
