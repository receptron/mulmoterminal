// The URL name — reserving it when the app is created, and flipping it public at publish.
//
// An app is handed out as `https://<host>/a/{slug}`, and `appSlugs/{slug}` is what resolves that
// name to an aid. Two things about that document shape the whole of this file:
//
//   - it is a TOP-LEVEL collection, because the public page has to resolve a slug BEFORE it can
//     read anything under `apps/{aid}`;
//   - it is UNREADABLE until the app is published (`allow read: if resource.data.published ==
//     true`), so that a human-readable name cannot be guessed to discover the aid — which is the
//     the address everything under `apps/{aid}` is keyed by.
//
// The second one is why this is more than a write. Nobody — the owner included — can ask which
// slug an app already holds, so `app.json` is the record: the reserved name is written back
// there, and a slug already recorded is never re-reserved. "Once you have it, you keep it" is
// the point (D2b) — a URL is a thing people have already sent to each other.
import { APP_SLUGS_COLLECTION, appSlugDoc } from "@receptron/sharedapp";
import { isRefusal, type SharedAppFailure, type SharedAppHandle } from "./context.js";
import { heldSlug } from "./recovery.js";
import { updateManifest } from "./manifestWrite.js";

/** How many numbered alternatives to try before giving up. The number is small on purpose: past
 *  `sakura-hair-8`, the author wanted a different name, not another digit. */
const MAX_CANDIDATES = 8;

export interface SlugReservation {
  ok: true;
  /** The slug this app holds now — the wanted one, or the numbered alternative that was free. */
  slug: string;
  /** Whether this call took it. False means it was already recorded in `app.json`. */
  reserved: boolean;
}

/** A reservation that failed, saying whether a NAME WAS ACTUALLY TAKEN before it did.
 *
 *  `partial` cannot answer that. It travels up meaning "the app itself is written; this is only
 *  its public name", which is true of every failure here — including the one where every candidate
 *  belonged to somebody else and nothing was written at all. The caller needs the finer question
 *  for two reasons: an irreversible `appSlugs` document is the thing to tell the author about, and
 *  advice about a name this app now holds is the opposite of the advice for a name it does not. */
export type SlugFailure = SharedAppFailure & { claimed?: string };

export type SlugResult = SlugReservation | SlugFailure;

/** `sakura-hair`, `sakura-hair-2`, `sakura-hair-3`, … — the collision rule from D2b.
 *
 *  Numbering starts at 2 because the unnumbered one IS the first: `sakura-hair-1` beside a
 *  `sakura-hair` owned by someone else reads as two apps of one company rather than a name that
 *  was taken. */
function candidates(wanted: string): string[] {
  return [wanted, ...Array.from({ length: MAX_CANDIDATES - 1 }, (_, index) => `${wanted}-${index + 2}`)];
}

/** Reserve the declared slug (or the first free numbering of it) and record it in `app.json`.
 *
 *  `alreadyHeld` says the declaration names a slug this app already reserved — then nothing is done
 *  at all. That is the whole reason the write-back exists: a reservation cannot be read back, so
 *  re-reserving every time would hand the app a new URL on every run.
 *
 *  IT IS ALWAYS RESERVED UNPUBLISHED, whatever the app's own state. Publish flips it — as its own
 *  step, after everything the name points at (`publish.ts`) — and that split is what makes a
 *  half-finished rename recoverable: reserving a PUBLISHED name and then failing to record it on
 *  the app document leaves a world-resolvable name the app does not know it holds, which no later
 *  `unpublish` can close, because unpublish acts on the name the app document says. Reserved
 *  unpublished, the same failure leaves a name that resolves for nobody, and the next publish
 *  reclaims it and flips it.
 *
 *  Ordering: this runs AFTER `apps/{aid}` is written, because the reservation's `allow create`
 *  resolves the owner through `get(apps/{aid})` — on a first run there is nothing to resolve until
 *  that document exists. */
export async function reserveSlug(handle: SharedAppHandle, aid: string, root: string, wanted: string, alreadyHeld: boolean): Promise<SlugResult> {
  if (alreadyHeld) return { ok: true, slug: wanted, reserved: false };

  const taken: string[] = [];
  for (const candidate of candidates(wanted)) {
    // `set`, not `create`. The create-if-absent primitive is a transaction that READS first, and
    // that read is refused for a reservation that does not exist yet (`allow read` tests
    // `resource.data.published`, which is not there) — so it can never claim a free name.
    //
    // A `set` is judged by `allow create` when the document is absent and by `allow update` when
    // it is not, and both require this app's owner: it succeeds exactly when the name is free or
    // already ours, and is refused when somebody else holds it. That refusal IS the answer, which
    // is why nothing is reported for it.
    const claimed = await claimSlug(handle, aid, candidate);
    if (claimed === "unknown") return probeFailed(candidate);
    if (claimed === "theirs") {
      taken.push(candidate);
      continue;
    }
    const recorded = await recordSlug(root, candidate);
    return recorded ?? { ok: true, slug: candidate, reserved: true };
  }
  return {
    ok: false,
    partial: true,
    problems: [
      `every candidate for the URL name is taken: ${taken.join(", ")}.`,
      "The app itself is written — this is only the public name. Choose a different `slug` in app.json and publish again.",
    ],
  };
}

/** Take the name, or find out that somebody else has it. One write, three answers.
 *
 *  `published: false`, always — see `reserveSlug`. A reclaim of a name that IS resolving therefore
 *  stops it resolving for the rest of the run, and publish's own step turns it back on. That is the
 *  fail-closed direction: the window is a name that opens nothing, not a name that opens an app
 *  nobody meant to open.
 *
 *  A rules refusal means the name is somebody else's — the reservation cannot be read, so this is
 *  the only way to ask. Anything else (a timeout, a quota) is the question never having been
 *  answered, and must NOT be read as a collision: doing so turns an outage into a second
 *  reservation, and if the name being reclaimed was public, the app records the numbered one while
 *  the original keeps resolving, beyond the reach of unpublish. */
type Ownership = "ours" | "theirs" | "unknown";

async function claimSlug(handle: SharedAppHandle, aid: string, slug: string): Promise<Ownership> {
  try {
    await handle.docs.set(APP_SLUGS_COLLECTION, slug, appSlugDoc(aid, false));
    return "ours";
  } catch (err) {
    return isRefusal(err) ? "theirs" : "unknown";
  }
}

function probeFailed(candidate: string): SharedAppFailure {
  return {
    ok: false,
    partial: true,
    problems: [
      `the URL name '${candidate}' could not be claimed, and the answer says nothing about WHY: the write failed in a way that is not a refusal, so the name may be free, may be this app's own reservation, or may be somebody else's.`,
      "Stopping rather than guessing: reading it as somebody else's and taking the next numbered name would strand a reservation this app may already hold — live, unreadable, and held forever by an app that no longer claims it.",
      "Nothing else about the app changed. Publishing again retries just this step.",
    ],
  };
}

/** Write the reserved name back, so the next publish does not reserve a second one.
 *
 *  Returns a failure only when the write failed, and that failure is REAL rather than cosmetic:
 *  the reservation is live and unreadable, so a lost write-back means the next run takes
 *  another name and the first one is held forever by an app that no longer claims it. */
async function recordSlug(root: string, slug: string): Promise<SlugFailure | null> {
  const updated = await updateManifest(root, (manifest) => (manifest.slug === slug ? null : { ...manifest, slug }));
  if (updated.ok) return null;
  return {
    ok: false,
    partial: true,
    // The name IS taken — this failure is about the record of it, not the reservation.
    claimed: slug,
    problems: [
      `the URL name '${slug}' was reserved, but writing it back to app.json failed:`,
      ...updated.problems,
      "Publishing again is the repair: a run that finds the name taken now asks whether it is THIS app's before moving on, so the reservation is not stranded.",
      // The name IS this app's here — it was claimed a moment ago — which is what makes "pick a
      // different one" the wrong instinct: it is the one edit that would strand it.
      ...heldSlug(slug),
    ],
  };
}

/** Stop a name this app no longer uses from resolving.
 *
 *  An author who renames the app's URL leaves the old reservation behind, and it keeps pointing at
 *  this aid. If it was published it goes on RESOLVING — and every later unpublish acts on the new
 *  name, so the URL the owner believes they took down still opens the app. Retiring means flipping
 *  the old one closed, not deleting it: the rules refuse deletes on purpose, because a freed name
 *  is one somebody else can claim and then serve from a URL that is already in circulation. */
export function retireSlug(handle: SharedAppHandle, aid: string, slug: string): Promise<void> {
  return handle.docs.set(APP_SLUGS_COLLECTION, slug, appSlugDoc(aid, false));
}

/** Flip the reservation's visibility. `true` is publish (the name starts resolving), `false` is
 *  unpublish (it stops).
 *
 *  A full replacement rather than a field update: `appSlugDoc` is two fields, both of which this
 *  operation knows, and the `FirestoreDocs` seam has no field-level write. The rules pin `aid`
 *  across an update, so a replacement naming a different app is refused rather than accepted. */
export function setSlugPublished(handle: SharedAppHandle, aid: string, slug: string, published: boolean): Promise<void> {
  return handle.docs.set(APP_SLUGS_COLLECTION, slug, appSlugDoc(aid, published));
}
