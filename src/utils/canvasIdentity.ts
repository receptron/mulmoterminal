// What makes two Canvas results "the same thing", per tool — the `identityOf` accessors that
// src/plugins-registry.ts hands to collapseByIdentity (see canvasCollapse.ts for the rule they
// feed, and why the superseded card is dropped).
//
// Separate from the registry so they can be tested without mounting it: the registry pulls in
// every plugin's Vue View and compiled stylesheet, none of which this decision involves.
//
// Each returns null for a result that must stand alone. That is the important default — an
// unrecognised shape, or content with nothing durable behind it, has no business superseding a
// card that is still on screen.
import { documentPathOf, type MarkdownToolData } from "@mulmoclaude/markdown-plugin/vue";
import { isRecord } from "../../common/isRecord";
import { collectionSlugOf } from "../../common/collectionSeed";
import { canonicalCardPath, NO_STORY_ROOTS, type StoryRootDirs } from "./canvasCardPath";

// A tool result's payload travels in `data` and `jsonData` both. Read through both because a
// partial update (a view persisting its state) may carry only one — the same lookup, for the same
// reason, as common/collectionSeed.ts's `collectionSlugOf`.
function payloadsOf(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) return [];
  return [result.data, result.jsonData].filter(isRecord);
}

/** A non-empty string field off whichever payload carries it. */
export function payloadString(result: unknown, field: string): string | null {
  for (const payload of payloadsOf(result)) {
    const value = payload[field];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/**
 * presentDocument: the document on disk, or null for inline markdown.
 *
 * The package's own accessor rather than a field read — `docPath` is authoritative, but results
 * stored before that field existed kept the path in `markdown`, and only `documentPathOf` knows
 * which values in there mean "path" rather than "a one-line document".
 */
export function documentIdentity(result: unknown): string | null {
  for (const payload of payloadsOf(result)) {
    // Built field by field rather than cast: `markdown` is required on MarkdownToolData and a
    // partial update may not carry it, so an assertion here would be a lie the compiler rejects.
    // An absent one becomes "", which is not a path, leaving `docPath` to answer on its own.
    const { markdown, docPath } = payload;
    const data: MarkdownToolData = {
      markdown: typeof markdown === "string" ? markdown : "",
      // Omitted rather than set to undefined: exactOptionalPropertyTypes is on.
      ...(typeof docPath === "string" ? { docPath } : {}),
    };
    const path = documentPathOf(data);
    if (path) return path;
  }
  return null;
}

/**
 * presentHtml / presentMulmoScript: the artifact on disk.
 *
 * `filePath` is required on both payloads (the HTML is too large to travel in the result; the
 * story's path is the wire form every mulmoScript endpoint keys on), and each tool's CREATE path
 * writes a FRESH path — so this collapses re-presentations of one artifact without ever merging
 * two distinct ones.
 *
 * Resolved to the file it names before comparing, because ONE deck has several wire spellings and
 * which one a card carries depends on what this server registered. `storyRoots` is what resolves
 * them; its default is "nothing registered", under which every card keeps the identity it had
 * before this existed — which is also what the browser has until `/api/config` lands.
 */
export function filePathIdentity(result: unknown, storyRoots: StoryRootDirs = NO_STORY_ROOTS): string | null {
  const filePath = payloadString(result, "filePath");
  if (filePath === null) return null;
  const root = payloadString(result, "root");
  // The FILE, whichever spelling this card carries — see canvasCardPath.ts. The wire spelling moves
  // when the user registers another directory, so identity built from it splits one deck into two
  // cards on a restart (#1976).
  const resolved = canonicalCardPath(filePath, root, storyRoots);
  if (resolved !== null) return resolved;
  // Nothing here can say where that path is: a root this server never registered, a config that has
  // not arrived, a relative path with no root to read it against. Then the wire spelling itself,
  // exactly as before — the PAIR, not the path, because since the workspace subtree became a named
  // stories root (#1933) two decks in different roots can share `stories/deck.json`, and collapsing
  // on the path alone merges two files into one card.
  return root === null ? filePath : `${root}\u0000${filePath}`;
}

/**
 * presentCollection: the collection, by slug alone — NOT slug+itemId.
 *
 * Editing a collection's schema and editing one of its records are one piece of work on one
 * subject, and the View self-fetches from the slug, so whichever card survives renders the
 * current state. Owner's call on the feedback behind this change (see the PR).
 *
 * The same key `reconcileCollectionCard` uses, deliberately. That rule drops a browser-seeded
 * placeholder from the STORE once the agent's real card lands (a placeholder is not history);
 * this one collapses real cards for display only. Two rules, one notion of "the same collection"
 * — hence one accessor.
 */
export function collectionIdentity(result: unknown): string | null {
  return collectionSlugOf(result) ?? null;
}
