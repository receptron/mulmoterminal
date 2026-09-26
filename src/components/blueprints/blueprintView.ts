// What the blueprint overlay shows for a step or a build, decided outside the templates so it can be
// tested without mounting anything. Words are message KEYS; the components translate them.
import type { StepState, StepStatus, WaitKind } from "../../../common/blueprint/state";
import { isRecord } from "../../../common/isRecord";
import type { BlueprintGate } from "../../../common/blueprint/plan";
import type { BlueprintManifest } from "../../../common/blueprint/manifest";
import type { HearingAnswer, HearingQuestion } from "../../../common/blueprint/hearing";

export interface StepLook {
  icon: string;
  tone: string;
  labelKey: string;
  /** Movement for a status that is in progress, so a working step visibly works. */
  motion: string;
}

const STEP_LOOKS: Record<StepStatus, StepLook> = {
  pending: { icon: "radio_button_unchecked", tone: "text-dim", labelKey: "blueprints.status.pending", motion: "" },
  "awaiting-approval": { icon: "front_hand", tone: "text-warn", labelKey: "blueprints.status.awaitingApproval", motion: "animate-pulse" },
  running: { icon: "progress_activity", tone: "text-accent", labelKey: "blueprints.status.running", motion: "animate-spin" },
  "awaiting-answer": { icon: "help", tone: "text-warn", labelKey: "blueprints.status.awaitingAnswer", motion: "animate-pulse" },
  passed: { icon: "check_circle", tone: "text-ok", labelKey: "blueprints.status.passed", motion: "" },
  failed: { icon: "error", tone: "text-err-text", labelKey: "blueprints.status.failed", motion: "" },
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

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Whole minutes and seconds between two moments, never negative. */
export function elapsedParts(fromMs: number, nowMs: number): { minutes: number; seconds: number } {
  const totalSeconds = Math.max(0, Math.floor((nowMs - fromMs) / MS_PER_SECOND));
  return { minutes: Math.floor(totalSeconds / SECONDS_PER_MINUTE), seconds: totalSeconds % SECONDS_PER_MINUTE };
}

// Which field of a tool's input says what it is doing, most telling first.
const INPUT_HINT_FIELDS = ["description", "command", "file_path", "path", "pattern", "url", "query", "prompt"] as const;
const SUMMARY_MAX_CHARS = 120;

const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_MAX_CHARS ? `${flat.slice(0, SUMMARY_MAX_CHARS - 1)}…` : flat;
};

/** A tool call as one short line: what the agent is doing, not the whole input. */
export function toolCallSummary(input: unknown): string {
  if (typeof input === "string") return oneLine(input);
  if (!isRecord(input)) return "";
  const hint = INPUT_HINT_FIELDS.map((field) => input[field]).find((value): value is string => typeof value === "string" && value.trim() !== "");
  return hint ? oneLine(hint) : "";
}
