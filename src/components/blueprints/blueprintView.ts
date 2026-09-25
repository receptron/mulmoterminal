// What the blueprint overlay shows for a step or a build, decided outside the templates so it can be
// tested without mounting anything. Words are message KEYS; the components translate them.
import type { StepState, StepStatus, WaitKind } from "../../../common/blueprint/state";
import type { BlueprintGate } from "../../../common/blueprint/plan";
import type { BlueprintManifest } from "../../../common/blueprint/manifest";
import type { HearingAnswer, HearingQuestion } from "../../../common/blueprint/hearing";

export interface StepLook {
  icon: string;
  tone: string;
  labelKey: string;
}

const STEP_LOOKS: Record<StepStatus, StepLook> = {
  pending: { icon: "radio_button_unchecked", tone: "text-dim", labelKey: "blueprints.status.pending" },
  "awaiting-approval": { icon: "front_hand", tone: "text-warn", labelKey: "blueprints.status.awaitingApproval" },
  running: { icon: "progress_activity", tone: "text-accent", labelKey: "blueprints.status.running" },
  "awaiting-answer": { icon: "help", tone: "text-warn", labelKey: "blueprints.status.awaitingAnswer" },
  passed: { icon: "check_circle", tone: "text-ok", labelKey: "blueprints.status.passed" },
  failed: { icon: "error", tone: "text-err-text", labelKey: "blueprints.status.failed" },
};

export const stepLook = (status: StepStatus): StepLook => STEP_LOOKS[status];

const WAIT_KEYS: Record<WaitKind, string> = {
  approval: "blueprints.waiting.approval",
  answer: "blueprints.waiting.answer",
  failure: "blueprints.waiting.failure",
};

export const waitKey = (kind: WaitKind | null): string | null => (kind ? WAIT_KEYS[kind] : null);

// Keyed by gate rather than written into the message path: the gate ids carry hyphens.
const GATE_KEYS: Record<BlueprintGate, string> = {
  review: "blueprints.gates.review",
  billing: "blueprints.gates.billing",
  "deploy-production": "blueprints.gates.deployProduction",
  delete: "blueprints.gates.delete",
  credential: "blueprints.gates.credential",
};

export const gateKey = (gate: BlueprintGate): string => GATE_KEYS[gate];

export interface PackChoice {
  slug: string;
  manifest: BlueprintManifest;
}

export const basePacks = (packs: readonly PackChoice[]): PackChoice[] => packs.filter((pack) => pack.manifest.kind === "base");

/** The usecases that say they can be built on `baseSlug`. */
export const usecasesFor = (packs: readonly PackChoice[], baseSlug: string): PackChoice[] =>
  packs.filter((pack) => pack.manifest.kind === "usecase" && pack.manifest.bases.includes(baseSlug));

/** A form field's text turned into the answer its question expects; undefined while it is blank. */
export function answerFromInput(question: HearingQuestion, raw: string): HearingAnswer | undefined {
  if (raw.trim() === "") return undefined;
  if (question.kind !== "number") return raw;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** A multiselect's answer with `choice` switched on or off. */
export function toggleChoice(current: HearingAnswer | undefined, choice: string): string[] {
  const chosen = Array.isArray(current) ? current : [];
  return chosen.includes(choice) ? chosen.filter((entry) => entry !== choice) : [...chosen, choice];
}

// The state machine's own word for a failed check; everything else in `reason` is what a person
// wrote when they rejected the step.
const CHECK_FAILED_REASON = "check failed";

/** A person's reason for stopping the step, or null when it stopped on a failed check. */
export const rejectionReason = (stepState: StepState | undefined): string | null =>
  stepState?.reason && stepState.reason !== CHECK_FAILED_REASON ? stepState.reason : null;
