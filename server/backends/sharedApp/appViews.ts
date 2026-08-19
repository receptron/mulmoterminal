// The app's own pages, written to the tier each audience may read.
//
// The public page keeps `config/*` — world-readable, one view, already in
// place. What is new here is the other two audiences, and the reason they
// cannot share that document is the rules: `config/{docId}` is
// `allow read: if true`, so a page written for the front desk would publish the
// app's internal vocabulary — status names, review-note headings, how work is
// assigned — to anybody who asks.
//
//   apps/{aid}/member/*   staffOf  — holds a role somewhere in the app
//   apps/{aid}/roster/*   listedIn — on the roster at all, participants too
//
// Three things about this file are decisions rather than plumbing:
//
//   THE PROJECTION IS PER TIER. A participant may not read `apps/{aid}` (their
//   classmates' addresses are in it), so the datasets their page draws — and
//   the field their own row is found by — can only reach them through the
//   tier's own `config` document. And one shared projection could not serve
//   both: handed the staff datasets, a participant's page builds a query the
//   rules REFUSE. It does not render less; it fails.
//
//   A WITHDRAWN PAGE IS DELETED, not merely stopped being written. The tier is
//   readable by everyone it admits, forever: drop a view from `views[]` and the
//   old page stays fetchable until something removes it, so publish withdraws
//   the `live:` documents its own declaration no longer names.
//
//   `live:` IS A PREFIX WITH NOTHING TO CONTRAST WITH, and it is kept anyway —
//   it is how that sweep tells a page THIS code wrote from any other document in
//   the tier. See `staleViewDocs` below.
import {
  appViewTierPath,
  participantScope,
  projectAppViews,
  viewConfigDocId,
  viewDocId,
  type AppViewTier,
  type AuthoredApp,
  type PublishStamp,
} from "@receptron/sharedapp";

import type { SharedAppFailure, SharedAppHandle } from "./context.js";
import { readAppViewFile } from "./publicView.js";
import type { WriteStep } from "./writes.js";

/** One page, read off disk and ready to write. */
interface TierPage {
  id: string;
  html: string;
}

/** One tier's writes, resolved: what to put there and what to take away. */
export interface TierPlan {
  tier: "member" | "roster";
  pages: TierPage[];
  /** The projection document, or null when this tier has no pages at all — in
   *  which case the whole tier is removed rather than left holding a config
   *  that lists nothing. */
  config: Record<string, unknown> | null;
}

export type TierPlanResult = { ok: true; plans: TierPlan[]; warnings: string[] } | { ok: false; problems: string[] };

/** A participant page naming a collection the rules will not open for them.
 *
 *  Refused rather than published with a hole: `projectAppViews` drops a
 *  collection it cannot state a scope for — it has to, since publishing
 *  `scope: "all"` against a rule that denies the read makes the page FAIL
 *  rather than show less — and a page silently handed nothing draws an empty
 *  screen with nothing anywhere to say why.
 *
 *  Checked here rather than only in the publish gate because this is where the pages are read off
 *  disk, and the answer is the manifest's own `participantRead` — which is what publish writes. */
function unreachableProblems(
  authored: AuthoredApp,
  view: { where: string; collections: string[] },
  audience: "member" | "participant",
  participantRead: readonly string[],
): string[] {
  if (audience !== "participant") return [];
  return view.collections
    .filter((cid) => participantScope(authored, cid, participantRead) === null)
    .map(
      (cid) =>
        `${view.where}.collections names '${cid}', which a participant cannot read: it is not in participantRead, and public.submit.${cid} declares no ` +
        'emailField, no uidField and no idFrom "auth.uid", so there is no row the rules would call theirs. The page would be refused the read, not handed fewer records.',
    );
}

/** Read every member and participant page the declaration names.
 *
 *  The same reader the public page uses, and the same refusals: a path to
 *  nothing, a page over the document limit, a page written against the host's
 *  bridge. It runs BEFORE anything is written, because a page that cannot be
 *  read must stop the operation rather than land after the schemas have gone
 *  out.
 *
 *  The `participantRead` in force is the manifest's, because that is what publish writes beside
 *  these pages. Getting it wrong publishes `scope: "all"` for a collection the rules then deny. */
export async function planAppViewTiers(root: string, authored: AuthoredApp, stamp: PublishStamp): Promise<TierPlanResult> {
  const tiers: AppViewTier[] = projectAppViews(authored, stamp);
  const problems: string[] = [];
  const warnings: string[] = [];
  const plans: TierPlan[] = [];
  const participantRead = authored.participantRead ?? [];
  for (const tier of tiers) {
    const pages: TierPage[] = [];
    for (const view of tier.views) {
      problems.push(...unreachableProblems(authored, view, tier.audience, participantRead));
      const read = await readAppViewFile(root, view, stamp.publishedAt, view.where);
      if (read.ok) {
        pages.push({ id: view.id, html: read.view.html });
        warnings.push(...read.view.warnings);
      } else problems.push(...read.problems);
    }
    plans.push({ tier: tier.tier, pages, config: tier.views.length > 0 ? tier.config : null });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, plans, warnings };
}

/** Document ids in a tier that this operation is about to write, at one stage. */
const wantedDocIds = (plan: TierPlan): Set<string> => {
  if (plan.config === null) return new Set();
  return new Set([viewConfigDocId(), ...plan.pages.map((page) => viewDocId(page.id))]);
};

/** Documents in this tier that the declaration no longer names.
 *
 *  Listed rather than inferred, for the reason the schemas' own sweep had: the
 *  declaration says what SHOULD be there and nothing says what is, so a page
 *  withdrawn from `views[]` leaves a document nothing would otherwise touch —
 *  and the entrance goes on offering it.
 *
 *  `live:` is the only prefix there is. There was a `staged:` set beside it, written by a deploy
 *  for the roster to try; both are gone (`plans/feat-shared-app-no-staging.md`). */
export async function staleViewDocs(handle: SharedAppHandle, aid: string, plan: TierPlan): Promise<{ ok: true; ids: string[] } | SharedAppFailure> {
  const keep = wantedDocIds(plan);
  try {
    const existing = await handle.docs.list(appViewTierPath(aid, plan.tier));
    return { ok: true, ids: existing.map((doc) => doc.id).filter((id) => id.startsWith("live:") && !keep.has(id)) };
  } catch (err) {
    return {
      ok: false,
      partial: false,
      problems: [
        `publish failed while reading the pages already at apps/${aid}/${plan.tier}: ${err instanceof Error ? err.message : String(err)}`,
        "Nothing was written. This read is what lets a page withdrawn from `views` be removed, so writing without it would leave the old one readable by everybody it was ever readable by.",
      ],
    };
  }
}

/** Withdrawals with the settings document last.
 *
 *  The mirror of writing it last. Deleting `live:config` first and then stopping
 *  leaves pages with nothing naming them — an entrance that lists nothing while
 *  the pages are still readable by everyone the tier admits. */
const withdrawalOrder = (stale: readonly string[]): string[] => [
  ...stale.filter((id) => !id.endsWith(":config")),
  ...stale.filter((id) => id.endsWith(":config")),
];

/** The writes for one tier: the pages, the settings that name them, then the
 *  withdrawals. Withdrawals go last because they grant nothing. */
export function tierWrites(handle: SharedAppHandle, aid: string, plan: TierPlan, stale: readonly string[], stamp: PublishStamp): WriteStep[] {
  const at = appViewTierPath(aid, plan.tier);
  const config = plan.config;
  return [
    // The PAGES first, then the settings that name them.
    //
    // `runWrites` can stop after any successful write, so the order decides
    // what a half-finished publish leaves. Settings-first leaves a document
    // naming a page that is not there — the entrance offers it and it cannot be
    // drawn. Pages-first leaves a page nobody has been told about, which is
    // invisible and harmless, and the next publish completes it.
    ...plan.pages.map((page) => ({
      what: `the ${plan.tier} page '${page.id}' (${at}/${viewDocId(page.id)})`,
      run: () => handle.docs.set(at, viewDocId(page.id), { html: page.html, publishedAt: stamp.publishedAt }),
    })),
    ...(config === null
      ? []
      : [
          {
            what: `the ${plan.tier} page settings (${at}/${viewConfigDocId()})`,
            run: () => handle.docs.set(at, viewConfigDocId(), config),
          },
        ]),
    // Withdrawals last, because they grant nothing — and the SETTINGS last
    // among them, for the reason they are written last: a run that stops
    // part-way should leave a page nobody is told about rather than a name with
    // nothing behind it.
    ...withdrawalOrder(stale).map((id) => ({
      what: `the withdrawal of ${at}/${id}`,
      run: async (): Promise<void> => {
        await handle.docs.delete(at, id);
      },
    })),
  ];
}

/** One tier, planned: what to write and what to take away. */
export interface PlannedTier {
  plan: TierPlan;
  stale: string[];
}

/** Everything publish needs before it writes a single document: the pages read
 *  off disk, and the documents in this tier the declaration no longer names.
 *
 *  Read off disk BEFORE anything is written: a page that is missing, oversized,
 *  or written against the host's bridge has to stop the run rather than land
 *  after the schemas have gone out.
 *
 *  ONE function, and it used to be shared by deploy and publish so the two could not disagree
 *  about what a tier contains. Publish is the only writer now. */
export async function planTierWrites(
  handle: SharedAppHandle,
  aid: string,
  request: { root: string; authored: AuthoredApp; stamp: PublishStamp },
): Promise<{ ok: true; tiers: PlannedTier[]; warnings: string[] } | SharedAppFailure> {
  const planned = await planAppViewTiers(request.root, request.authored, request.stamp);
  if (!planned.ok) return { ok: false, partial: false, problems: planned.problems };
  const tiers: PlannedTier[] = [];
  for (const plan of planned.plans) {
    const stale = await staleViewDocs(handle, aid, plan);
    if (!stale.ok) return stale;
    tiers.push({ plan, stale: stale.ids });
  }
  return { ok: true, tiers, warnings: planned.warnings };
}

/** The writes for every tier, in one list. */
export const allTierWrites = (handle: SharedAppHandle, aid: string, tiers: readonly PlannedTier[], stamp: PublishStamp): WriteStep[] =>
  tiers.flatMap(({ plan, stale }) => tierWrites(handle, aid, plan, stale, stamp));

/** The page ids one tier put in place, for the operation's report. */
export const pageIdsOf = (tiers: readonly PlannedTier[], tier: "member" | "roster"): string[] =>
  tiers.filter(({ plan }) => plan.tier === tier).flatMap(({ plan }) => plan.pages.map((page) => page.id));
