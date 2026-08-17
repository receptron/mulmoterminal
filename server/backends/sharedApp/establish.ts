// The two writes an operation makes BEFORE it may read anything: claiming the app document, and
// holding the URL name.
//
// Both used to live in `deploy`, which is gone. They are here rather than in `publish` because
// `init` performs them too — that is what "the app exists from the moment it is created" means
// (`plans/feat-shared-app-no-staging.md`): the app document carries the roster, the reservation
// holds the name, and from then on the author can write records and run `preview` against them.
//
// The ORDER is fixed and is the whole reason this is a module rather than two lines: `appSlugs`'
// create rule resolves the owner through `get(apps/{aid})`, so a reservation made before the app
// document exists is denied rather than mis-authorized.
import { APPS_COLLECTION } from "@receptron/sharedapp";
import type { SharedAppFailure, SharedAppHandle } from "./context.js";
import { heldSlug, neverRemove } from "./recovery.js";
import { reserveSlug, retireSlug, type SlugResult } from "./slug.js";

/** What a reservation needs to know. */
export interface SlugRequest {
  handle: SharedAppHandle;
  aid: string;
  root: string;
  /** The name `app.json` asks for, or undefined when it names none. */
  wanted: string | undefined;
  /** The name the app document says this app already holds. */
  held: string | undefined;
  /** The app document as it will stand, so the reservation can be recorded on it. */
  appDoc: Record<string, unknown>;
}

/** Reserve the declared URL name if this app does not already hold it, and record the result on
 *  the app document so the next operation does not reserve a SECOND one.
 *
 *  Undefined when the declaration names no slug — reserving a name nobody asked for would take it
 *  from someone who did. The reservation is IRREVERSIBLE (`appSlugs` has `allow delete: if false`),
 *  which is why it follows a name the author wrote rather than one this code invents.
 *
 *  The extra app-document write is the price of the ordering: the reservation cannot be made
 *  before `apps/{aid}` exists, and what was reserved cannot be recorded before it is reserved. It
 *  happens only on the run that actually takes a name. */
export async function reserveHeldSlug({ handle, aid, root, wanted, held, appDoc }: SlugRequest): Promise<SlugResult | undefined> {
  if (wanted === undefined) return undefined;
  // Reserved UNPUBLISHED, whatever this app's own state — publish flips it as its own step. See
  // `reserveSlug`: it is what makes a half-finished rename recoverable.
  const reservation = await reserveSlug(handle, aid, root, wanted, held === wanted);
  if (!reservation.ok || !reservation.reserved) return reservation;
  // A rename leaves the previous name pointing here, and a published one goes on RESOLVING —
  // while every later unpublish acts on the new name, so the URL the owner believes they took
  // down still opens the app. Retire it before the record moves, so a failure here leaves the
  // record on the old name and the next run repeats exactly this step.
  if (held !== undefined && held !== reservation.slug) {
    try {
      await retireSlug(handle, aid, held);
    } catch (err) {
      return {
        ok: false,
        partial: true,
        problems: [
          `the URL name '${reservation.slug}' was reserved, but the previous name '${held}' could not be retired: ${err instanceof Error ? err.message : String(err)}`,
          `Run it again — until '${held}' is closed it still resolves to this app, and later unpublishes would not touch it.`,
        ],
      };
    }
  }
  try {
    await handle.docs.set(APPS_COLLECTION, aid, { ...appDoc, slug: reservation.slug });
  } catch (err) {
    return {
      ok: false,
      partial: true,
      problems: [
        `the URL name '${reservation.slug}' was reserved and written to app.json, but recording it on apps/${aid} failed: ${err instanceof Error ? err.message : String(err)}`,
        "Run it again — the reservation is this app's, and the next run recognises that rather than taking a numbered name.",
        // Said HERE and not at the operation's edge, because here it is known that a name was
        // actually taken: a failure that reserved nothing (every candidate belonged to somebody
        // else) ends with the opposite advice, and appending this to both would contradict it.
        ...heldSlug(reservation.slug),
      ],
    };
  }
  return reservation;
}

/** Write the app document when it is not there — which is also the only way to LEARN whether it
 *  was ours to write.
 *
 *  `set` and not `create`. The create-if-absent primitive is a transaction that begins by READING
 *  the document, and that read is refused for exactly the document it is meant to create: the read
 *  rule resolves the roster out of the document itself, so for a missing one the expression fails
 *  and the answer is denied. The transaction dies there, every time, on a brand-new aid.
 *
 *  A `set` is subject to `allow create` when the document is absent and `allow update` when it is
 *  not — and both require this session to be the owner. So it succeeds exactly when the app is
 *  ours to write, and a refusal covers the two cases we cannot tell apart from here. The message
 *  names both, because both are things the operator can check. */
export async function claimApp(handle: SharedAppHandle, aid: string, appDoc: Record<string, unknown>): Promise<SharedAppFailure | null> {
  try {
    await handle.docs.set(APPS_COLLECTION, aid, appDoc);
    return null;
  } catch (err) {
    return {
      ok: false,
      partial: false,
      problems: [
        `cannot write the app document (apps/${aid}): ${err instanceof Error ? err.message : String(err)}`,
        "Two things are refused the same way here, and both are worth checking:",
        `  - the address this session is signed in with is not the one app.json names as owner (it must be a key of \`members\` with \`"*": "owner"\`);`,
        `  - apps/${aid} already exists and belongs to somebody else's roster — this address was removed from it, or the aid came from a repository you are not on.`,
        "**Do not edit or remove `aid`.** It is the app's identity: a new one does not repair anything, it creates a SECOND app while the first — and everybody's records in it — stays where it is, reachable only by whoever is still on its roster. Recover access from an owner, or confirm this declaration is the app you meant.",
        "Nothing was written.",
      ],
    };
  }
}

/** The reservation as `init` and `fork` make it: a brand-new app, holding nothing yet, not open.
 *
 *  Both of them end the same way — the app document is live, `app.json` is written, and the name
 *  is the last thing left — so the failure they report is the same sentence, and it is PARTIAL:
 *  publishing takes the name, so a refusal here is a delay rather than damage. */
export async function holdNewName(
  handle: SharedAppHandle,
  aid: string,
  root: string,
  wanted: string | undefined,
  reservation: Record<string, unknown>,
): Promise<{ ok: true; slug: string | undefined } | SharedAppFailure> {
  const held = await reserveHeldSlug({ handle, aid, root, wanted, held: undefined, appDoc: reservation });
  if (held === undefined) return { ok: true, slug: undefined };
  if (!held.ok) {
    return {
      ...held,
      partial: true,
      problems: [
        ...held.problems,
        // PUBLISH, and not "run it again". By the time this is reached the app document is live
        // and `app.json` is written, which is exactly the state both entry points refuse: `init`
        // will not touch a repository that already declares an app, and `fork` will not fork one
        // the signed-in address now owns. Publish is the only operation that resumes the
        // reservation, and telling the author otherwise sends them into a refusal that reads like
        // a second failure.
        `The app itself is fine: apps/${aid} exists and app.json is written — this is the URL name and nothing else. \`publish\` retries just this step; re-running \`init\` or \`fork\` will not, because the app they refuse to overwrite is now this one.`,
        // `neverRemove` and not `strandedApp`: this app document is the repository's own and it is
        // in use. What carries over is only the pair of repairs that are not repairs.
        ...neverRemove(aid),
      ],
    };
  }
  return { ok: true, slug: held.slug };
}
