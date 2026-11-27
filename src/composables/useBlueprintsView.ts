// Navigation seam for the full-screen blueprint overlay — same shape as useRoomsView. The open BUILD
// is the URL, so a build waiting for its owner's approval can be linked to and reloaded.
import { personLanguageSchema } from "../../common/blueprint/personLanguage";
import { computed, shallowRef, type ComputedRef } from "vue";
import { z } from "zod";
import { hearingAnswersSchema } from "../../common/blueprint/hearing";
import { readSessionStored, removeSessionStored, writeSessionStored } from "../utils/localStore";
import { router } from "../router";
import { overlayOriginState, overlayReturnPath } from "./overlayOrigin";
import { lastPlaceIn } from "./overlayLastPlace";
import { RUN_ID_RE } from "../../common/blueprint/run";

export function blueprintsViewOpen(runId?: string): void {
  const last = lastBlueprintsPlace();
  if (runId === undefined && last !== null) {
    void router.push({ path: last, state: overlayOriginState() });
    return;
  }
  const to = runId && RUN_ID_RE.test(runId) ? { name: "blueprintRun", params: { run: runId } } : { name: "blueprints" };
  void router.push({ ...to, state: overlayOriginState() });
}

export function blueprintsViewClose(): void {
  void router.push(overlayReturnPath());
}

/** Moves INSIDE the overlay with `replace`, so closing returns to where it was opened from. */
export function blueprintsViewSelect(runId: string | null): void {
  const to = runId ? { name: "blueprintRun", params: { run: runId } } : { name: "blueprints" };
  void router.replace({ ...to, state: overlayOriginState() });
}

export function blueprintsViewMarket(): void {
  void router.replace({ name: "blueprintMarket", state: overlayOriginState() });
}

const formFillSchema = z.object({
  base: z.string(),
  usecase: z.string(),
  answers: hearingAnswersSchema,
  projectDir: z.string(),
  after: z.string().optional(),
  preset: z.string().optional(),
  language: personLanguageSchema.optional(),
});

/**
 * A new-build form filled in advance: a finished build's next step (`after` names the build it continues), or the form
 * as the person left it to answer Claude Code's trust prompt (`preset` names the example it was started from).
 */
export type FormFill = Readonly<z.infer<typeof formFillSchema>>;

// Handed to the new-build form the next time it opens; taken once, so a later visit to the form starts empty.
const pendingFill = shallowRef<FormFill | null>(null);
// A kept form also waits in this tab's sessionStorage: the person is away in a terminal, and a reload meanwhile
// (after updating MulmoTerminal, say) must not lose what they typed.
const KEPT_FORM_KEY = "blueprints.keptForm";
// Long enough to answer a trust prompt and come back; past it, a kept form belongs to a detour the person gave up on.
export const KEPT_FORM_MAX_AGE_MS = 30 * 60 * 1000;
const keptFormSchema = z.object({ keptAtMs: z.number(), fill: formFillSchema });

type KeptForm = z.infer<typeof keptFormSchema>;
// The kept form in memory, with when it was kept: the same age limit holds for it as for the stored copy.
const keptFill = shallowRef<KeptForm | null>(null);

const fresh = (kept: KeptForm | null, nowMs: number): FormFill | null => (kept !== null && nowMs - kept.keptAtMs <= KEPT_FORM_MAX_AGE_MS ? kept.fill : null);

function keptInSession(): KeptForm | null {
  const raw = readSessionStored(KEPT_FORM_KEY);
  if (raw === null) return null;
  try {
    const parsed = keptFormSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function blueprintsViewFollowUp(followUp: FormFill): void {
  pendingFill.value = followUp;
  blueprintsViewSelect(null);
}

/** Keeps what the form holds for when it opens again, without opening it: the person is going elsewhere first. */
export function keepFormFill(fill: FormFill): void {
  const kept = { keptAtMs: Date.now(), fill };
  keptFill.value = kept;
  writeSessionStored(KEPT_FORM_KEY, JSON.stringify(kept));
}

/** The form to open with, taken once: a follow-up, else a kept form that is not too old — from memory, or after a reload from storage. */
export function takeFormFill(): FormFill | null {
  const nowMs = Date.now();
  const fill = pendingFill.value ?? fresh(keptFill.value ?? keptInSession(), nowMs);
  pendingFill.value = null;
  keptFill.value = null;
  removeSessionStored(KEPT_FORM_KEY);
  return fill;
}

const ROUTE_NAMES = new Set(["blueprints", "blueprintRun", "blueprintMarket"]);
const lastBlueprintsPlace = lastPlaceIn(ROUTE_NAMES);

export function useBlueprintsView(): { isOpen: ComputedRef<boolean>; runId: ComputedRef<string | null>; inMarket: ComputedRef<boolean>; close: () => void } {
  const route = computed(() => router.currentRoute.value);
  return {
    isOpen: computed(() => ROUTE_NAMES.has(String(route.value.name))),
    inMarket: computed(() => route.value.name === "blueprintMarket"),
    runId: computed(() => {
      const raw = route.value.params.run;
      return typeof raw === "string" && RUN_ID_RE.test(raw) ? raw : null;
    }),
    close: blueprintsViewClose,
  };
}
