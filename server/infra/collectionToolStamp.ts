// Refuse a direct write the deployed rules are certain to refuse, and say which path does work.
//
// `public.submit.<cid>.stampField` pins a field to GOOGLE's clock: `stampOk` requires the record to
// CARRY `request.time` on create, and it sits in the top conjunction of `createWith`, so it binds
// the owner exactly as it binds a visitor. Only a client that can send Firestore's
// `serverTimestamp()` sentinel can satisfy it — which the submit path does
// (`participate/submit.ts` hands `recordOf` a `serverTimestamp`) and `manageCollection putItems`
// cannot: it writes the literal value the agent typed, and a literal never equals `request.time`.
//
// So every `putItems` create into such a collection is refused, deterministically, and the refusal
// arrives as Firestore's "Missing or insufficient permissions" — which names no field, no rule and
// no alternative. That is the shape of failure the shared-app skill warns leads an agent to start
// editing `app.json` to get past it.
//
// WHY A HOST DECORATOR AND NOT A FIX. The store COULD stamp: MulmoTerminal supplies the Firestore
// adapter itself (`setFirestoreAccessor` in `backends/sharedCollections.ts`), and core calls it
// after validation — so a sentinel substituted there would reach `setDoc` intact, and MulmoClaude
// is not affected either way (it declares no support for shared collections and unbound its
// accessor, mulmoclaude#2870).
//
// What stops it is a boundary core states outright. `encodeRecordTimes` is the codec on that write
// path, and its own comment says where the line is: the declaration that pins the field lives in
// `app.json` under `public.submit.<cid>`, "which this package reads only for `aid`". It decides
// provenance from the STORED value instead — was this field an instant before? — and records the
// consequence in the same breath: `previous` is null on a create, "which is correct rather than a
// gap: the rules require a created stamp to equal `request.time`, which no client can construct,
// so a create through this store never carries a valid one."
//
// So a create through `putItems` failing is a DECIDED property of this store, not an oversight,
// and teaching the adapter to stamp means teaching it to read `public.submit`, which is the scope
// line core drew. This guard makes that decision legible where an agent meets it; it does not
// relitigate it. If it should be relitigated, the place is core's codec, not a wrapper here.
import path from "node:path";
import { readFile } from "node:fs/promises";

import { parseAuthoredApp } from "@receptron/sharedapp";

import { APP_MANIFEST_FILE } from "@mulmoclaude/core/collection/server";

/** The stamped field this call's collection declares, or null when there is none to worry about. */
async function stampFieldFor(root: string, cid: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(root, APP_MANIFEST_FILE), "utf-8");
  } catch {
    // No app.json is the ordinary case for a LOCAL collection, and it is not this guard's business
    // to have an opinion about it. The engine answers whatever it answers.
    return null;
  }
  const parsed = parseAuthoredApp(raw);
  if (!parsed.ok) return null;
  return parsed.app.public?.submit?.[cid]?.stampField ?? null;
}

/**
 * The refusal, or null to let the call through.
 *
 * ONE situation, and it is the certain one: **`mode: "create"`**. `encodeRecordTimes` is handed a
 * null `previous` on a create, so nothing is converted and the literal the agent typed is what
 * reaches Firestore — where `stampOk` compares it with `request.time` and refuses. No value the
 * agent could have sent works.
 *
 * AN UPDATE IS LEFT ALONE, INCLUDING ONE THAT CARRIES THE FIELD, and the earlier version of this
 * guard was wrong to refuse those. On an update `previous` is the stored document, so the codec
 * re-encodes a stamp that WAS an instant back into the identical Timestamp — `stampHeld` sees no
 * change and the write goes through. That is not an accident; it is the case core's comment says
 * the provenance check is FOR ("the frozen stamp goes back unchanged, so a whole-record write
 * survives the rules"). Refusing it broke a `getItems` → edit → `putItems` round trip that works.
 *
 * What that costs: an update carrying a DIFFERENT value is still refused by `stampHeld`, and this
 * guard cannot tell it from the round trip without reading the stored record. Letting that one
 * reach an opaque error is the lesser harm — breaking a supported write to catch it is not a trade
 * worth making.
 */
export function stampGuardProblem(args: Record<string, unknown>, stampField: string, cid: string): string | null {
  const mode = typeof args.mode === "string" ? args.mode : "upsert";
  if (mode !== "create") return null;
  return [
    `This write cannot succeed: every row here is a create, and the rules require '${stampField}' to hold the SERVER's clock on create.`,
    "",
    `\`public.submit.${cid}.stampField\` names '${stampField}', so the rules pin it to \`request.time\` (\`stampOk\`) and freeze it afterwards (\`stampHeld\`).`,
    "That is what makes the ORDER of these records trustworthy — it is the one field a writer cannot back-date, and it binds the owner too.",
    "A direct write can only send a literal value, and a literal never equals the server's clock, so Firestore refuses it as a permission error that names nothing.",
    "",
    "Post through the submit path instead, which fills the field with the server's own timestamp:",
    `  - from another machine: \`useSharedApp\` with \`action: "submit"\`, \`cid: "${cid}"\``,
    "  - from a published page: `view.submit(cid, values)`",
    `Do not send '${stampField}' yourself on either — it is filled in for you, and a value sent is overwritten.`,
    "",
    `\`manageCollection\` still edits these records: an update that leaves '${stampField}' alone is allowed.`,
  ].join("\n");
}

/** Wrap a manageCollection handler so a doomed `putItems` is refused with an instruction rather
 *  than by Firestore with a permission error. */
export function withStampGuard(handler: (args: Record<string, unknown>) => Promise<string>, rootOf: () => string) {
  return async (args: Record<string, unknown>): Promise<string> => {
    if (args.action !== "putItems" || typeof args.slug !== "string") return handler(args);
    const cid = args.slug;
    const stampField = await stampFieldFor(rootOf(), cid);
    if (stampField === null) return handler(args);
    return stampGuardProblem(args, stampField, cid) ?? handler(args);
  };
}
