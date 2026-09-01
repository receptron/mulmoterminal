// The access summary, for the pane that draws it.
//
// PURE, and that is the point of it having a file of its own next to `preview.ts`: `projectPublish`
// takes no clock, no filesystem and no Firestore, so "who can see what" is answerable from the
// working tree alone. The preview beside it needs a signed-in session because it READS the app's
// records; this needs none, which is why it can be shown in a pane whose preview is switched off,
// on a machine that has never connected.
//
// It projects rather than reading `app.json` directly. The rules evaluate `apps/{aid}` and its
// `public` block, and the manifest is not those documents — `participantRead`, the roster and the
// per-tier submit projections are all decided by the compiler. Reading the manifest here would be a
// second implementation of the compiler, and the two would agree until the day they did not.
import { projectPublish } from "@receptron/sharedapp";
import { readAuthored, schemasOf, sharedCollections } from "./context.js";
import { sharedAppAccessOf, type SharedAppAccess } from "../../../common/sharedAppAccess.js";

/** The stamp `projectPublish` requires and this answer does not use.
 *
 *  Named rather than inlined so it is obvious that nothing below reads it: the stamp decides
 *  `owner`, `publishedAt` and `publishedCommit`, and not one rule predicate about access consults
 *  any of them. Passing the real one would mean resolving git and a Firebase session to compute
 *  three fields that are then thrown away. */
const UNUSED_STAMP = { uid: "", email: "", publishedAt: 0 };

export type AccessResult = { ok: true; access: SharedAppAccess } | { ok: false; problems: string[] };

/** What publishing this directory would grant, per collection.
 *
 *  A declaration with PROBLEMS is still answered. The author is looking at the panel while they
 *  edit, and a summary that disappears whenever the manifest is momentarily wrong is a summary
 *  nobody keeps open — the gate that refuses a bad publish is `publish`, not this. Only a manifest
 *  that cannot be PARSED has no answer, because there is no declaration to summarize. */
export async function sharedAppAccess(root: string): Promise<AccessResult> {
  const authored = await readAuthored(root);
  if (!authored.ok) return { ok: false, problems: authored.problems };

  const collections = await sharedCollections(root);
  const face = projectPublish(authored.app, schemasOf(collections), UNUSED_STAMP, null);
  return {
    ok: true,
    access: sharedAppAccessOf(
      face.app,
      face.public,
      collections.map((collection) => collection.slug),
    ),
  };
}
