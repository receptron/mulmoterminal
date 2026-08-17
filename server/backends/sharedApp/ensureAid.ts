// The `aid` is generated HERE, by code, when `app.json` does not have one yet.
//
// Not by the agent (design D2b): `apps/{aid}` is a shelf every user of the deployment shares, and
// the rules' `allow create` asks only that you name yourself owner — so a memorable aid is
// first-come-first-served, cannot be checked for availability (the app document is not readable
// until you are on its roster), and frees up again when an app is deleted. A UUID has none of
// those properties, and a model asked to invent an identifier writes a memorable one.
//
// And it happens when `app.json` is WRITTEN rather than at publish: `acceptStorageSchema` refuses
// a firestore schema whose root declares no aid, so waiting until publish would make the author's
// first collection unopenable until they had published — the wrong end of the process to discover
// it from.
//
// The writing itself — atomic, mode-preserving, symlink-following, one at a time — is
// `updateManifest`'s, shared with the slug write-back for the reason both are here: `app.json`
// belongs to the author, and each of these changes exactly one key of it.
import { randomUUID } from "node:crypto";
import { updateManifest } from "./manifestWrite.js";

export interface EnsureAidSuccess {
  ok: true;
  aid: string;
  /** Whether this call minted it. Reported rather than inferred, because "your app.json now says
   *  something it did not say a moment ago" is a thing the operator should hear once. */
  created: boolean;
}

export type EnsureAidResult = EnsureAidSuccess | { ok: false; problems: string[] };

/** Read `<root>/app.json` and hand back the `aid` it ALREADY has — refusing when it has none.
 *
 *  Publish's question, and it is the opposite of `ensureAid`'s. Minting is right where a
 *  declaration is being WRITTEN (`init`, and the collection tool's first schema — see
 *  `server/infra/collectionToolAid.ts`): there is no app yet, so an id that is not there is a
 *  blank to fill.
 *
 *  At publish there IS an app — that is what is being published — so an id that is not there is a
 *  declaration that lost one, and minting would create a SECOND app: a new document, a roster of
 *  one, and none of the records. Nothing on disk would say it happened, and the original stays
 *  where it is with everybody's data in it. That is not a hypothetical failure mode but the shape
 *  of an actual recovery attempt: "it is stuck, let me clear the aid and publish again" is the
 *  first thing an agent reaches for, and until this refusal existed it worked — quietly, and
 *  wrongly. */
export async function requireAid(root: string): Promise<EnsureAidResult> {
  // The same reader the mutation below uses, asked to change nothing: one parse, one lock, one
  // set of messages for a missing or malformed file.
  const read = await updateManifest(root, () => null);
  if (!read.ok) return read;

  const current = read.manifest.aid;
  if (typeof current === "string" && current.length > 0) return { ok: true, aid: current, created: false };
  return {
    ok: false,
    problems: [
      "app.json declares no `aid`, and publish will not generate one.",
      "An aid is the app's identity — the address every record, page and roster entry already lives under. Writing a new one here would publish a SECOND app: a fresh document, a roster of one, none of the records, and the first one left exactly where it is.",
      "Put the original value back rather than inventing one. It is a committed file, so it is in version control: `git show HEAD:app.json` (or the pull request that added it) has it, and it is also what any earlier publish wrote into `apps/{aid}`.",
      "If this repository genuinely has no app yet, `init` is what starts one — it writes the aid, claims the app and reserves the URL name in the right order.",
    ],
  };
}

/** Read `<root>/app.json`, and give it an `aid` if it has none. */
export async function ensureAid(root: string): Promise<EnsureAidResult> {
  let minted: string | null = null;
  const updated = await updateManifest(root, (manifest) => {
    const current = manifest.aid;
    if (typeof current === "string" && current.length > 0) return null;
    minted = randomUUID();
    return { ...manifest, aid: minted };
  });
  if (!updated.ok) return updated;
  if (minted !== null) return { ok: true, aid: minted, created: true };

  const current = updated.manifest.aid;
  // Unreachable by construction — the mutation returns null only when it read a usable string —
  // but stated rather than asserted: this is the value every later step keys on.
  if (typeof current !== "string" || current.length === 0) {
    return { ok: false, problems: ["app.json has no usable aid, and one could not be generated."] };
  }
  return { ok: true, aid: current, created: false };
}
