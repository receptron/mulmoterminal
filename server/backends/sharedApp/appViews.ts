// The app's own pages, written to the tier each audience may read.
//
// The public page keeps `config/*` — world-readable, one view, already
// deployed. What is new here is the other two audiences, and the reason they
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
//   old page stays fetchable until something removes it. Deploy withdraws its
//   `staged:`, publish withdraws its `live:`.
//
//   DEPLOY AND PUBLISH WRITE THE SAME SHAPE at two prefixes. That is what makes
//   "try the staff page before the customers see it" possible at all, and it is
//   the same road the schemas already travel (`staging/{cid}` then
//   `collections/{cid}`).
import { appViewTierPath, participantScope, viewConfigDocId, viewDocId, type AuthoredApp, type PublishStamp } from "@mulmoclaude/core/collection/server";

import { randomUUID } from "node:crypto";

import { isRecord } from "../../../common/isRecord.js";
import { projectAppViews, type AppViewTier } from "./appViewProjection.js";
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

export type TierPlanResult = { ok: true; plans: TierPlan[] } | { ok: false; problems: string[] };

/** A participant page naming a collection the rules will not open for them.
 *
 *  Refused rather than published with a hole: `projectAppViews` drops a
 *  collection it cannot state a scope for — it has to, since publishing
 *  `scope: "all"` against a rule that denies the read makes the page FAIL
 *  rather than show less — and a page silently handed nothing draws an empty
 *  screen with nothing anywhere to say why.
 *
 *  Checked here rather than only in the publish gate because the set in force
 *  is different at each end: deploy writes the manifest's `participantRead`,
 *  publish promotes what deploy staged. Core's `promotedRoleProblems` says the
 *  same thing about the publish end; this is what says it at the deploy end,
 *  where the manifest IS the truth. */
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
        `${view.where}.collections names '${cid}', which a participant cannot read: it is not in participantRead, and public.submit.${cid} declares neither ` +
        'an emailField nor idFrom "auth.uid", so there is no row the rules would call theirs. The page would be refused the read, not handed fewer records.',
    );
}

/** Read every member and participant page the declaration names.
 *
 *  The same reader the public page uses, and the same refusals: a path to
 *  nothing, a page over the document limit, a page written against the host's
 *  bridge. It runs BEFORE anything is written, because a page that cannot be
 *  read must stop the operation rather than land after the schemas have been
 *  promoted.
 *
 *  `promoted` is the `participantRead` that will actually be in force — at
 *  publish, what deploy staged rather than what `app.json` says now. Getting
 *  this wrong publishes `scope: "all"` for a collection the rules then deny. */
export async function planAppViewTiers(root: string, authored: AuthoredApp, stamp: PublishStamp): Promise<TierPlanResult> {
  const tiers: AppViewTier[] = projectAppViews(authored, stamp);
  const problems: string[] = [];
  const plans: TierPlan[] = [];
  const participantRead = authored.participantRead ?? [];
  for (const tier of tiers) {
    const pages: TierPage[] = [];
    for (const view of tier.views) {
      problems.push(...unreachableProblems(authored, view, tier.audience, participantRead));
      const read = await readAppViewFile(root, view, stamp.publishedAt, view.where);
      if (read.ok) pages.push({ id: view.id, html: read.view.html });
      else problems.push(...read.problems);
    }
    plans.push({ tier: tier.tier, pages, config: tier.views.length > 0 ? tier.config : null });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, plans };
}

/** Document ids in a tier that this operation is about to write, at one stage. */
const wantedDocIds = (plan: TierPlan): Set<string> => {
  if (plan.config === null) return new Set();
  return new Set([viewConfigDocId("staged"), ...plan.pages.map((page) => viewDocId("staged", page.id))]);
};

/** Documents at this stage that the declaration no longer names.
 *
 *  Listed rather than inferred, for the reason `staleStaged` gives about the
 *  schemas: a page withdrawn from `views[]` leaves a document nothing would
 *  otherwise touch, `/staging/{aid}` goes on offering it, and the next publish
 *  promotes it.
 *
 *  Only this stage's documents are considered. `unpublish` deletes `live:*` and
 *  keeps `staged:*` on purpose — closing the doors is not undeploying — so a
 *  publish that tidied the other prefix would quietly undo that. */
export async function staleViewDocs(handle: SharedAppHandle, aid: string, plan: TierPlan): Promise<{ ok: true; ids: string[] } | SharedAppFailure> {
  const keep = wantedDocIds(plan);
  try {
    const existing = await handle.docs.list(appViewTierPath(aid, plan.tier));
    return { ok: true, ids: existing.map((doc) => doc.id).filter((id) => id.startsWith("staged:") && !keep.has(id)) };
  } catch (err) {
    return {
      ok: false,
      partial: false,
      problems: [
        `deploy failed while reading the pages already at apps/${aid}/${plan.tier}: ${err instanceof Error ? err.message : String(err)}`,
        "Nothing was written. This read is what lets a page withdrawn from `views` be removed, so writing without it would leave the old one readable by everybody it was ever readable by.",
      ],
    };
  }
}

/** Withdrawals with the settings document last.
 *
 *  The mirror of writing it last. Deleting `staged:config` first and then
 *  stopping leaves pages with nothing naming them — which publish has to refuse
 *  rather than promote, because it cannot tell them from a deploy that meant to
 *  keep them. */
const withdrawalOrder = (stale: readonly string[]): string[] => [
  ...stale.filter((id) => !id.endsWith(":config")),
  ...stale.filter((id) => id.endsWith(":config")),
];

/** The writes for one tier: the pages, the settings that name them, then the
 *  withdrawals. Withdrawals go last because they grant nothing. */
export function tierWrites(handle: SharedAppHandle, aid: string, plan: TierPlan, stale: readonly string[], stamp: PublishStamp, deployId: string): WriteStep[] {
  const at = appViewTierPath(aid, plan.tier);
  const config = plan.config;
  return [
    // The PAGES first, then the settings that name them.
    //
    // `runWrites` can stop after any successful write, so the order decides
    // what a half-finished deploy leaves. Settings-first leaves a document
    // naming a page that is not there — the entrance offers it and it cannot be
    // drawn. Pages-first leaves a page nobody has been told about, which is
    // invisible and harmless, and the next deploy completes it.
    ...plan.pages.map((page) => ({
      what: `the ${plan.tier} page '${page.id}' (${at}/${viewDocId("staged", page.id)})`,
      run: () => handle.docs.set(at, viewDocId("staged", page.id), { html: page.html, publishedAt: stamp.publishedAt, deployId }),
    })),
    ...(config === null
      ? []
      : [
          {
            what: `the ${plan.tier} page settings (${at}/${viewConfigDocId("staged")})`,
            run: () => handle.docs.set(at, viewConfigDocId("staged"), { ...config, deployId }),
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

/** One deletion, named as the operator would name it. */
export const tierDelete = (handle: SharedAppHandle, aid: string, tier: "member" | "roster", docId: string): WriteStep => ({
  what: `the withdrawal of ${appViewTierPath(aid, tier)}/${docId}`,
  run: async (): Promise<void> => {
    await handle.docs.delete(appViewTierPath(aid, tier), docId);
  },
});

/** Everything PUBLISHED in either tier, for a take-down.
 *
 *  Listed rather than derived from `views[]`, because unpublish deliberately
 *  does not read the declaration: it has to work when the declaration is
 *  broken, which is one of the times an operator most wants it. `staged:` is
 *  not returned — closing the doors is not undoing a deploy.
 *
 *  A tier that cannot be listed is not fatal on its own, but it is not silent
 *  either: pages left behind stay readable by everyone the tier ever admitted,
 *  which is exactly what a take-down is for. */
export async function liveTierDocs(
  handle: SharedAppHandle,
  aid: string,
): Promise<{ ok: true; tiers: { tier: "member" | "roster"; ids: string[] }[] } | SharedAppFailure> {
  const tiers: { tier: "member" | "roster"; ids: string[] }[] = [];
  for (const tier of ["member", "roster"] as const) {
    try {
      const existing = await handle.docs.list(appViewTierPath(aid, tier));
      tiers.push({ tier, ids: existing.map((doc) => doc.id).filter((id) => id.startsWith("live:")) });
    } catch (err) {
      return {
        ok: false,
        partial: false,
        problems: [
          `unpublish failed while reading the published pages at apps/${aid}/${tier}: ${err instanceof Error ? err.message : String(err)}`,
          "Nothing was written. Those pages are readable by everybody that tier admits, so taking the app down without removing them would leave the app's own staff page live on a closed app.",
        ],
      };
    }
  }
  return { ok: true, tiers };
}

/** One tier, planned: what to write and what to take away. */
export interface PlannedTier {
  plan: TierPlan;
  stale: string[];
}

/** Everything both operations need before they write a single document: the
 *  pages read off disk, and the documents at this stage the declaration no
 *  longer names.
 *
 *  Read off disk BEFORE either operation writes anything: a page that is
 *  missing, oversized, or written against the host's bridge has to stop the run
 *  rather than land after the schemas have been promoted.
 *
 *  ONE function for deploy and publish, because the two must not be able to
 *  disagree about what a tier contains — the whole point of `staged:` and
 *  `live:` sharing a shape is that what the roster tried is what the members
 *  get. What differs is the stage, and the `participantRead` in force. */
export async function planTierWrites(
  handle: SharedAppHandle,
  aid: string,
  request: { root: string; authored: AuthoredApp; stamp: PublishStamp },
): Promise<{ ok: true; tiers: PlannedTier[]; deployId: string } | SharedAppFailure> {
  const planned = await planAppViewTiers(request.root, request.authored, request.stamp);
  if (!planned.ok) return { ok: false, partial: false, problems: planned.problems };
  const tiers: PlannedTier[] = [];
  for (const plan of planned.plans) {
    const stale = await staleViewDocs(handle, aid, plan);
    if (!stale.ok) return stale;
    tiers.push({ plan, stale: stale.ids });
  }
  return { ok: true, tiers, deployId: randomUUID() };
}

/** The writes for every tier, in one list. */
export const allTierWrites = (handle: SharedAppHandle, aid: string, tiers: readonly PlannedTier[], stamp: PublishStamp, deployId: string): WriteStep[] =>
  tiers.flatMap(({ plan, stale }) => tierWrites(handle, aid, plan, stale, stamp, deployId));

/** The page ids one tier put in place, for the operation's report. */
export const pageIdsOf = (tiers: readonly PlannedTier[], tier: "member" | "roster"): string[] =>
  tiers.filter(({ plan }) => plan.tier === tier).flatMap(({ plan }) => plan.pages.map((page) => page.id));

/** One tier's promotion: the staged documents to copy live, and the live ones
 *  the staged set no longer names. */
export interface TierPromotion {
  tier: "member" | "roster";
  /** The deploy this tier's staged documents came from, when they say. */
  deployId?: string | undefined;
  promote: { docId: string; data: Record<string, unknown> }[];
  stale: string[];
}

/** What publish will do to the tiers, read from what DEPLOY staged.
 *
 *  Not re-projected from the working tree, and this is the whole point of the
 *  split: `/staging/{aid}` is where the roster tried these pages, so publish
 *  promotes exactly that. Reading the files again here would let an edit made
 *  after the last deploy go live without anybody having looked at it — the same
 *  guarantee `readStaged` makes about the schemas, in the same words.
 *
 *  It also removes a question that cannot be answered correctly from the
 *  manifest: the participant scopes in a staged projection were computed
 *  against the `participantRead` that deploy staged, which is exactly the one
 *  publish promotes. */
/** Is what deploy left INTERNALLY consistent, before publish re-stamps it?
 *
 *  This check exists because promotion erases the evidence. Deploy writes a
 *  tier's pages and then the settings that name them, and `runWrites` can stop
 *  between any two writes — so a redeploy interrupted part-way leaves the new
 *  settings beside the previous deploy's HTML. The runtime NOTICES that in
 *  staging (the two carry different stamps and it refuses to draw), but publish
 *  stamps everything it promotes with the publish stamp, which would make the
 *  mismatched pair look like one publish and hand a page fields it has never
 *  seen.
 *
 *  So the refusal is here rather than a repair: what a half-finished deploy
 *  left is not a state publish can reason about, and deploying again is one
 *  command.
 *
 *  It is checked on a `deployId` rather than on the CLOCK. `publishedAt` is a
 *  millisecond, and a millisecond is not an identity: two deploys can share one
 *  (a coarse clock, two runs at once, the injected `now` a test uses), and then
 *  a mixed set compares equal and passes. A per-run UUID cannot. */
function stagedProblems(aid: string, tier: "member" | "roster", staged: readonly { id: string; data: unknown }[]): string[] {
  const at = `apps/${aid}/${tier}`;
  const config = staged.find((doc) => doc.id === "staged:config");
  if (config === undefined) {
    // Pages with no settings is the OTHER half-finished deploy: withdrawing a
    // tier deletes its settings and its pages, and a run that stopped between
    // the two leaves exactly this. Promoting what survived would make a page
    // live that the last deploy was in the middle of taking away — and with no
    // settings to name it, nothing would list it either.
    return staged.length === 0
      ? []
      : [
          `${at} has staged pages (${staged.map((doc) => doc.id).join(", ")}) and no staged:config. A deploy stopped part-way through withdrawing them. ` +
            "Deploy again — that finishes the withdrawal. Nothing was written.",
        ];
  }
  const settings = isRecord(config.data) ? config.data : {};
  const deployId = settings.deployId;
  const declared = Array.isArray(settings.views) ? settings.views : [];
  if (typeof deployId !== "string") {
    return [
      `${at}/staged:config carries no deployId, so there is no way to tell which deploy its pages came from. Deploy again — publish promotes a set it can ` +
        "check, and this is not one. Nothing was written.",
    ];
  }
  return declared.flatMap((view) => {
    if (!isRecord(view) || typeof view.id !== "string") return [];
    const page = staged.find((doc) => doc.id === `staged:${view.id}`);
    if (page === undefined) {
      return [
        `${at}/staged:config names the page '${view.id}', which is not staged. A deploy stopped part-way, so what is staged is not what the declaration says. ` +
          "Deploy again — publish promotes what the roster reviewed, and this is not it. Nothing was written.",
      ];
    }
    if (!isRecord(page.data) || page.data.deployId !== deployId) {
      return [
        `${at}/staged:${view.id} was staged by a different deploy from ${at}/staged:config. A deploy stopped between the two, so the page and the datasets it ` +
          "would be handed do not belong together. Deploy again. Nothing was written.",
      ];
    }
    return [];
  });
}

/** The staged documents this publish promotes: the settings, and exactly the
 *  pages they name.
 *
 *  Everything else staged is left where it is. It is deploy's to tidy — the
 *  next one repeats the deletion that failed — and until then it is invisible:
 *  nothing lists a page the settings do not name, here or at `/staging/{aid}`. */
function promotable(staged: readonly { id: string; data: unknown }[]): { id: string; data: unknown }[] {
  const config = staged.find((doc) => doc.id === "staged:config");
  if (config === undefined) return [];
  const settings = isRecord(config.data) ? config.data : {};
  const declared = Array.isArray(settings.views) ? settings.views : [];
  const wanted = new Set(declared.flatMap((view) => (isRecord(view) && typeof view.id === "string" ? [`staged:${view.id}`] : [])));
  return staged.filter((doc) => doc.id === "staged:config" || wanted.has(doc.id));
}

export async function planTierPromotion(
  handle: SharedAppHandle,
  aid: string,
  stamp: PublishStamp,
): Promise<{ ok: true; tiers: TierPromotion[] } | SharedAppFailure> {
  const tiers: TierPromotion[] = [];
  for (const tier of ["member", "roster"] as const) {
    const at = appViewTierPath(aid, tier);
    let existing;
    try {
      existing = await handle.docs.list(at);
    } catch (err) {
      return {
        ok: false,
        partial: false,
        problems: [
          `publish failed while reading the staged pages at ${at}: ${err instanceof Error ? err.message : String(err)}`,
          "Nothing was written. Publishing again is safe.",
        ],
      };
    }
    const staged = existing.filter((doc) => doc.id.startsWith("staged:"));
    const incoherent = stagedProblems(aid, tier, staged);
    if (incoherent.length > 0) return { ok: false, partial: false, problems: incoherent };
    // What the SETTINGS name, not what happens to be lying in the tier.
    //
    // A redeploy that drops a page writes the new settings and then deletes the
    // old `staged:` document; if that deletion fails, the settings are perfectly
    // coherent and the withdrawn page is still there. Promoting everything
    // staged would put it back — live, and named by nothing.
    //
    // Re-stamped, like `promoteSchema`: the stamp answers "which version is
    // live right now", so it belongs to the operation that changes the answer.
    // It also has to match across the settings and every page, because the
    // runtime refuses to draw a pair that disagrees.
    const named = promotable(staged);
    const promote = named.map((doc) => ({
      docId: `live:${doc.id.slice("staged:".length)}`,
      data: { ...(isRecord(doc.data) ? doc.data : {}), publishedAt: stamp.publishedAt },
    }));
    const keep = new Set(promote.map((entry) => entry.docId));
    const stale = existing.map((doc) => doc.id).filter((id) => id.startsWith("live:") && !keep.has(id));
    const settings = staged.find((doc) => doc.id === "staged:config");
    const deployId = isRecord(settings?.data) && typeof settings.data.deployId === "string" ? settings.data.deployId : undefined;
    tiers.push({ tier, deployId, promote, stale });
  }
  return { ok: true, tiers };
}

/** The writes that promote one publish's pages: the copies, then the
 *  withdrawals. Withdrawals last because they grant nothing. */
export const promotionWrites = (handle: SharedAppHandle, aid: string, tiers: readonly TierPromotion[]): WriteStep[] =>
  tiers.flatMap((tier) => {
    const at = appViewTierPath(aid, tier.tier);
    // The same order deploy uses, and for the same reason: the PAGES first,
    // then the settings that name them. The listing these came from is by
    // document id, which puts `config` before every page — so without this the
    // first publish of a tier could advertise a page that is not there yet if
    // the run stopped in between.
    const promote = [...tier.promote.filter((entry) => !entry.docId.endsWith(":config")), ...tier.promote.filter((entry) => entry.docId.endsWith(":config"))];
    return [
      ...promote.map((entry) => ({
        what: `the ${tier.tier} page (${at}/${entry.docId})`,
        run: () => handle.docs.set(at, entry.docId, entry.data),
      })),
      ...withdrawalOrder(tier.stale).map((docId) => tierDelete(handle, aid, tier.tier, docId)),
    ];
  });

/** The page ids one publish put live, for its report. */
export const promotedIdsOf = (tiers: readonly TierPromotion[], tier: "member" | "roster"): string[] =>
  tiers
    .filter((entry) => entry.tier === tier)
    .flatMap((entry) => entry.promote.map((page) => page.docId.slice("live:".length)))
    .filter((id) => id !== "config");

/** Do the schemas and the pages come from ONE deploy?
 *
 *  They are written by the same run, in sequence, and `runWrites` can stop
 *  between them — so a redeploy that changes a schema AND a page can leave the
 *  new schema staged beside the previous page. Both would then be promoted, and
 *  the page would draw fields that the version it was written against did not
 *  have. Neither document is wrong on its own; the PAIR is.
 *
 *  Only documents that carry an id are compared. Staged schemas exist in the
 *  wild from before this field, and refusing to publish every app until it is
 *  redeployed would be a worse failure than the one this guards. What is
 *  refused is a disagreement we can actually see. */
export function generationProblems(aid: string, staged: readonly { cid: string; doc: Record<string, unknown> }[], tiers: readonly TierPromotion[]): string[] {
  const seen = new Map<string, string[]>();
  for (const entry of staged) {
    if (typeof entry.doc.deployId !== "string") continue;
    seen.set(entry.doc.deployId, [...(seen.get(entry.doc.deployId) ?? []), `staging/${entry.cid}`]);
  }
  for (const tier of tiers) {
    if (tier.deployId === undefined) continue;
    seen.set(tier.deployId, [...(seen.get(tier.deployId) ?? []), `${tier.tier}/staged:config`]);
  }
  if (seen.size < 2) return [];
  const groups = [...seen.values()].map((where) => where.join(", "));
  return [
    `apps/${aid} has staged documents from more than one deploy (${groups.join(" | ")}). A deploy stopped part-way, so what is staged is a mixture: a page ` +
      "would be promoted beside a schema it was not written against. Deploy again — that stages one complete set. Nothing was written.",
  ];
}
