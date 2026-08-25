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
// WHY A HOST DECORATOR AND NOT A FIX. Making `putItems` itself stamp would mean injecting a
// sentinel object into the record, and the record is validated and linted BY VALUE on the way
// through (`validateRecordObject`, `lintOf` in `@mulmoclaude/core`). The sentinel would have to be
// substituted below that, inside core's write layer — a change to the engine MulmoClaude binds
// too, not to this host's wiring. Until that is wanted, refusing early with an explanation is
// strictly better than the permission error, and it costs no behaviour: nothing that would have
// been written stops being written.
import path from "node:path";
import { readFile } from "node:fs/promises";

import { parseAuthoredApp } from "@receptron/sharedapp";

import { isRecord } from "../../common/isRecord.js";
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

/** Which rows this call carries, when it carries them inline.
 *
 *  `itemsFile` is deliberately NOT read. It exists for batches of thousands, and reading one to
 *  decide a diagnostic would double the largest read in the tool; the mode test below already
 *  catches the case that matters for a file (a generated batch is a `create`). */
function inlineItems(args: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(args.items) ? args.items.filter(isRecord) : [];
}

/**
 * The refusal, or null to let the call through.
 *
 * Two situations, and only the first is certain:
 *
 *  - **`mode: "create"`** — every row is a create, and `stampOk` refuses every one of them. There
 *    is no value the agent could have sent that works.
 *  - **a row CARRYING the stamped field** — meaningless in any mode, because the server decides
 *    this value. On a create it is refused by `stampOk`; on an update by `stampHeld`, unless it
 *    happens to equal what is stored.
 *
 * An update that leaves the field alone is passed through untouched: `stampHeld` only asks that it
 * does not MOVE, so correcting a message's body after it was posted is a write that works and must
 * keep working.
 */
export function stampGuardProblem(args: Record<string, unknown>, stampField: string, cid: string): string | null {
  const mode = typeof args.mode === "string" ? args.mode : "upsert";
  const carrying = inlineItems(args).filter((item) => stampField in item);
  if (mode !== "create" && carrying.length === 0) return null;
  const because =
    mode === "create"
      ? `every row here is a create, and the rules require '${stampField}' to hold the SERVER's clock on create`
      : `${carrying.length} of these rows carry '${stampField}', which is the server's to write and not this call's`;
  return [
    `This write cannot succeed: ${because}.`,
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
