// What a half-finished run owes the reader: what is standing on the server, which parts of it can
// be picked back up, and which repair must not be attempted.
//
// One module rather than a sentence per call site, because these are the lines the NEXT operation
// is decided from and they have to say the same thing every time. A run that reports `partial`
// without naming what it left behind is answered by guesswork, and the guesses are predictable:
// clear the `aid` and start over, delete the app document, take a different name. The first two
// are the damaging ones and neither can be undone.
import { APPS_COLLECTION } from "@receptron/sharedapp";

/** The two repairs that are not repairs, said the same way wherever an aid is named.
 *
 *  DELETING THE APP DOCUMENT is not reachable from here — the rules refuse it and this host is an
 *  ordinary rules-bound client, writing as the signed-in user — but it IS reachable from the
 *  console, `firebase firestore:delete --recursive` and any Admin-SDK script, which the owner of
 *  an app has. What it costs is worth stating exactly, because "permanently lost" would be false
 *  and "harmless" would be worse: Firestore does not cascade, and every child is authorized
 *  THROUGH the parent, so while `apps/{aid}` is missing every rules-bound reader — the app's own
 *  pages, the Collections pane, these tools — is denied on the whole subtree. The data is still
 *  there; only the door is gone. Re-creating the document under the SAME aid opens it again, which
 *  is what publishing does, and it is the only route that ends with a working app: an
 *  administrative recursive delete reaches the records too, but it removes them.
 *
 *  CHANGING THE AID is the other one, and it is the reason the first matters. A fresh id publishes
 *  a SECOND app — a roster of one, none of the records — and leaves the first exactly where it is,
 *  with the aid that would have re-opened it now gone from the file that recorded it.
 *  `requireAid` refuses that at publish; this is the same sentence for the author about to do it
 *  by hand. */
export const neverRemove = (aid: string): string[] => [
  `**Do not delete ${APPS_COLLECTION}/${aid}, and do not change \`aid\` to start over.** Nothing here can delete it (the rules refuse it, and this host is a rules-bound client) — but the Firebase console and \`firebase firestore:delete --recursive\` can, and that is the trap: Firestore does not cascade, and everything under an app document — the records, config/*, member/* and roster/* — is authorized THROUGH it, so while the parent is missing every rules-bound reader is denied on the whole subtree.`,
  `The records are not gone with it: re-creating ${APPS_COLLECTION}/${aid} under the SAME aid — which is what publishing again does — makes them reachable once more. Losing the aid is what makes that irreversible, which is why a fresh one is never the way out: it publishes a second app and abandons the first.`,
  "To empty an app, delete its records. To stop serving it, `unpublish`.",
];

/** An app id this run reserved and then could not use. */
export const strandedApp = (aid: string): string[] => [
  `${APPS_COLLECTION}/${aid} stands on the server, owned by this address. Leave it: an unused app document carries a roster of one, grants nothing, and costs nothing.`,
  ...neverRemove(aid),
];

/** An app id this run was PUBLISHING when it stopped — the app is this repository's own, and some
 *  of the writes landed.
 *
 *  There is no cleanup step and there is not meant to be one: publish writes everything the app is
 *  from the working tree in one operation, so the repair for a run that stopped in the middle is
 *  the same run again (`plans/feat-shared-app-no-staging.md`). Said explicitly because a
 *  half-written app invites the two irreversible repairs above, and it is the state that invites
 *  them hardest. */
export const halfPublishedApp = (aid: string): string[] => [
  `This run stopped with writes already landed — the lines above say which. Fix what it reported and publish ${APPS_COLLECTION}/${aid} again: publish writes everything the app is from the working tree, so the next run re-does all of it, including the steps that did land. There is no cleanup step and nothing to undo by hand.`,
  ...neverRemove(aid),
];

/** A URL name that is now taken, and how it is picked back up rather than replaced.
 *
 *  The reservation is irreversible on purpose (`appSlugs` refuses deletes, so a name already in
 *  circulation can never come to mean a different app), which makes "choose another name" look
 *  like the only way forward. It is not, and the difference matters: a second name leaves the
 *  first held forever by an app that no longer claims it. `reserveSlug` treats a name this app
 *  already holds as held — nothing is re-taken — so the repair is to change nothing and run it
 *  again. */
export const heldSlug = (slug: string): string[] => [
  `The URL name '${slug}' is this app's now, and a reservation cannot be released (\`appSlugs\` refuses deletes, so a name already handed out can never come to mean a different app).`,
  `That is not a loss, and it does not call for a new name: the next run recognises a name this app already holds rather than replacing it with a numbered one. Changing \`slug\` in app.json is the one edit that would strand '${slug}' — held forever by an app that no longer claims it.`,
];
