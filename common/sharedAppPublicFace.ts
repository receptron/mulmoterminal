// How open an app's PUBLIC FACE is — the one thing an author is most likely to assume wrongly, and
// the thing this repository got wrong by reading the DECLARATION where it should have read the
// SWITCH.
//
// Here rather than in `server/` because both ends decide from it: publish and preview compute it,
// and the pane's diagnostic header prints it (this repository's rule for a value both sides read).
//
// THREE states, not two. The middle one is what a correctly built invite-only app looks like: a
// member page cannot write a record without a `public.submit` declaration (the package's
// `tierSubmit` projects it to the member tier without consulting `public.enabled`), so an app that
// only its roster ever sees still carries a `public` block. Reading that block's EXISTENCE as
// "open" told such an author their family's app was open to the world (#1926).

/** Three answers, in the order they matter to the person reading them.
 *
 *  - `open` — anonymous visitors may reach it. `apps/{aid}.public.enabled` is true, which is the
 *    one thing `publicOn()` in mulmoserver's `firestore.rules` asks, and the one thing
 *    `readPublicConfig` asks before it draws the page at `/a/{slug}`.
 *  - `declared` — a `public` block exists and the switch is NOT on. Normal, and normally
 *    deliberate: the block is there so the roster's own pages can submit.
 *  - `none` — no `public` block at all. */
export type PublicFace = "open" | "declared" | "none";

/** Read the face off the PROJECTED block — `projectApp`'s `public`, the field the rules read —
 *  rather than off the author's declaration. The projection is what lands in Firestore, so a
 *  disagreement between the two is a bug in the projection and not something to paper over here. */
export function publicFaceOf(block: Record<string, unknown> | undefined): PublicFace {
  if (block === undefined) return "none";
  return block.enabled === true ? "open" : "declared";
}
