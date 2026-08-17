// What a half-finished run owes the reader: what is standing on the server, which parts of it can
// be picked back up, and which repair must not be attempted.
//
// One module rather than a sentence per call site, because these are the lines the NEXT operation
// is decided from and they have to say the same thing every time. A run that reports `partial`
// without naming what it left behind is answered by guesswork, and the guesses are predictable:
// clear the `aid` and start over, delete the app document, take a different name. The first two
// are the damaging ones and neither can be undone.
import { APPS_COLLECTION } from "@receptron/sharedapp";

/** The repair that must not be attempted, said the same way wherever an aid is named.
 *
 *  IT IS THE ONE OPERATION NOTHING CAN UNDO, and it is worth spelling out because the rules do not
 *  stop the author: `allow delete: if false` binds a CLIENT, and the host holds an Admin
 *  credential — so the person most likely to try it is the one the rule cannot reach. Firestore
 *  does not cascade, and every rule authorizing a child resolves the roster THROUGH the parent, so
 *  a deleted `apps/{aid}` leaves its records, config, member and roster documents behind with the
 *  expression that guards them failing: unreadable and undeletable, permanently, by anybody.
 *
 *  The other half is the `aid` itself. A new one does not repair anything — it publishes a SECOND
 *  app beside the first, with a roster of one and none of the records, and nothing on disk says it
 *  happened. `requireAid` refuses that at publish; this is the same sentence for the author who is
 *  about to do it by hand. */
const neverRemove = (aid: string): string[] => [
  `**Do not delete ${APPS_COLLECTION}/${aid}, and do not change \`aid\` to start over.** Firestore does not cascade: everything under an app document — the records, config/*, member/* and roster/* — is authorized through it, so removing the parent leaves that subtree permanently unreadable and undeletable, by anybody. And a fresh aid does not reset an app; it creates a second one, leaving the first exactly where it is.`,
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
  `The URL name '${slug}' cannot be released once reserved (\`appSlugs\` refuses deletes, so a name already handed out can never come to mean a different app).`,
  `That is not a loss: leave \`slug\` as it is in app.json and run the same operation again — a name this app already holds is recognised rather than replaced with a numbered one. Changing it now is what would strand '${slug}'.`,
];
