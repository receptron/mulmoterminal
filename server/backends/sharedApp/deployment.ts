// WHETHER THE DEPLOYMENT CAN SERVE WHAT THIS PUBLISH IS ABOUT TO WRITE.
//
// Everything under `apps/{aid}` is judged by `../mulmoserver/firestore.rules`, which is deployed
// BY HAND with no CI in the path — so a publisher here has been writing against rules whose
// version nobody recorded (docs/shared-app-principles.md, item 3). When the two disagree the
// author does not find out: publish succeeds, and the person the app is for meets a refusal, or a
// page drawn from a projection the deployed runtime does not understand.
//
// `deployment/capabilities` is the record that ends that (`../mulmoserver/src/firestore/
// deployment.ts` writes the reader and the rules for it: world-readable, writable by no client).
// This module is the publisher's half — it reads the record and decides what publish may do about
// it. Three answers, and the difference between them is the whole design:
//
//   - BEHIND  → refuse. The deployment has been recorded and the record says it does not
//     understand what we would write. That is the only case where continuing produces the silent
//     failure above, so it is the only case that stops the run.
//   - ABSENT  → say so and continue. Every deployment predates this record until someone writes
//     it, and a host-side gate is a diagnostic, not an authority (principle 2). Refusing here
//     would brick publish for every existing deployment on the day this ships, in the name of a
//     fact we do not have.
//   - UNREADABLE → say so and continue, for the same reason plus one: "we could not ask" and
//     "there is no record" are different sentences and neither is evidence of incapability.
//
// The runtime version is REPORTED, never refused on: `@receptron/sharedapp` compiles the
// projection here and renders it there, so a mismatch is worth naming — but the compiler does not
// yet stamp a projection version (item 7-2, which needs a release of that package), so what we can
// say is which two versions are in play, not whether they are compatible.
import { createRequire } from "node:module";

import { type SharedAppHandle } from "./context.js";

/** The `@receptron/sharedapp` version actually loaded, not the range `package.json` asks for: the
 *  range is what we would accept and the resolved version is what compiled this projection, and it
 *  is the second one the deployment has to match. Read once, and never fatal — a version we cannot
 *  determine is reported as unknown rather than turned into a refusal. */
let runtimeVersion: string | undefined;
export function sharedappRuntime(): string {
  if (runtimeVersion === undefined) {
    try {
      const require = createRequire(import.meta.url);
      const pkg: unknown = require("@receptron/sharedapp/package.json");
      runtimeVersion = isRecord(pkg) && typeof pkg.version === "string" ? pkg.version : "unknown";
    } catch {
      runtimeVersion = "unknown";
    }
  }
  return runtimeVersion;
}

/** The document, at a path that names no app: it describes the DEPLOYMENT, and this question is
 *  asked before the app is written. Kept in step with `../mulmoserver/src/firestore/deployment.ts`
 *  by hand — the two repositories share no code, which is exactly why the record exists. */
export const DEPLOYMENT_COLLECTION = "deployment";
export const CAPABILITIES_DOC = "capabilities";

/** The lowest `rulesVersion` this publisher's writes need.
 *
 *  BUMP IT when publish starts writing something the OLD rules would refuse or mis-authorize —
 *  in the same change, and only then. It is not a version of this program: raising it because the
 *  publisher changed, when the rules did not have to, refuses publish on deployments that would
 *  have served the app perfectly. */
export const REQUIRED_RULES_VERSION = 1;

export interface DeploymentCapabilities {
  rulesVersion: number;
  runtime?: string | undefined;
  deployedAt?: number | undefined;
  note?: string | undefined;
}

/** What was found, said in the three ways publish treats differently. */
export type CapabilityReading = { state: "known"; capabilities: DeploymentCapabilities } | { state: "absent" } | { state: "unreadable"; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const numberOf = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
const textOf = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export async function readDeploymentCapabilities(handle: SharedAppHandle): Promise<CapabilityReading> {
  let raw: unknown;
  try {
    raw = await handle.docs.get(DEPLOYMENT_COLLECTION, CAPABILITIES_DOC);
  } catch (err) {
    return { state: "unreadable", reason: err instanceof Error ? err.message : String(err) };
  }
  if (!isRecord(raw)) return { state: "absent" };
  const rulesVersion = numberOf(raw.rulesVersion);
  // A document with no version is a document that answers nothing. Absent rather than unreadable:
  // the read worked, and what came back simply does not say.
  if (rulesVersion === undefined) return { state: "absent" };
  return { state: "known", capabilities: { rulesVersion, runtime: textOf(raw.runtime), deployedAt: numberOf(raw.deployedAt), note: textOf(raw.note) } };
}

/** The problems to refuse with, or none.
 *
 *  Separate from the read so the decision is testable without a Firestore: this is the part that
 *  says which readings stop a publish, and it is the part that will be argued about. */
export function capabilityRefusal(reading: CapabilityReading, required = REQUIRED_RULES_VERSION): string[] {
  if (reading.state !== "known") return [];
  const { rulesVersion } = reading.capabilities;
  if (rulesVersion >= required) return [];
  return [
    `This deployment's rules are version ${rulesVersion}; publishing what is declared here needs at least ${required}.`,
    "Nothing was written. The rules live in `../mulmoserver/firestore.rules` and are deployed by hand (`firebase deploy --only firestore:rules`); after deploying, write the new number into `deployment/capabilities` so the next publish can see it.",
    "Publishing against older rules is not a smaller version of working: the writes are refused, or accepted and then served to the people the app is for in a way nobody here would see.",
  ];
}

/** What publish should SAY about the deployment when it is not refusing. Notes, not problems —
 *  they travel with a successful run. */
export function capabilityNotes(reading: CapabilityReading, runtime: string): string[] {
  if (reading.state === "absent") {
    return [
      `This deployment does not record which rules are live (\`${DEPLOYMENT_COLLECTION}/${CAPABILITIES_DOC}\` is missing or carries no \`rulesVersion\`), so publish could not check that it understands what was written. Writing that record once, at deploy time, is what makes the check real.`,
    ];
  }
  if (reading.state === "unreadable") {
    return [
      `Could not read this deployment's recorded capabilities (${reading.reason}). Publish continued: a failure to ask is not evidence that the deployment is behind.`,
    ];
  }
  const deployed = reading.capabilities.runtime;
  if (deployed !== undefined && deployed !== runtime) {
    return [
      `This app was compiled with @receptron/sharedapp ${runtime}; the deployment records ${deployed} for the runtime that renders it. That is not necessarily wrong — but a page drawn by a runtime older than the projection is the failure that shows as a blank page, so it is worth knowing which two are in play.`,
    ];
  }
  return [];
}
