<script setup lang="ts">
// Starting a build: where it goes, which template, and the template's interview. Nothing starts until
// every question that applies is answered — the first step writes the spec from these answers, and a
// gap here is a guess there.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isPersonLanguage, PERSON_LANGUAGE_NAMES, type PersonLanguage } from "../../../common/blueprint/personLanguage";
import {
  folderPresentPaths,
  listKnownFolders,
  listPacks,
  listPresets,
  previewPair,
  startRun,
  suggestFolder,
  type PackList,
  type PairPreview,
} from "../../composables/blueprintsApi";
import type { PresetListing } from "../../../common/blueprint/presets";
import type { Refusal } from "../../../common/blueprint/refusal";
import {
  acceptedAnswers,
  askedQuestions,
  defaultAnswers,
  folderAnswers,
  neededPaths,
  offeredOptions,
  settledAnswers,
  unansweredQuestions,
  type HearingAnswer,
  type HearingAnswers,
} from "../../../common/blueprint/hearing";
import { basePacks, basesFor, firstOfEachUsecase, presetGroups, usecaseGroups, usecasesFor } from "./blueprintView";
import { latestOnly } from "./latestOnly";
import { failureText } from "./refusalText";
import { keepFormFill, takeFormFill, type FormFill } from "../../composables/useBlueprintsView";
import { onOverlayShownAgain, useOverlayVisible } from "../../composables/overlayVisibility";
import { openTerminalAt } from "../../composables/useNewTerminal";
import BlueprintHearingField from "./BlueprintHearingField.vue";

const emit = defineEmits<{ started: [runId: string] }>();
const { t, locale } = useI18n();

const packs = ref<PackList>([]);
const base = ref("");
const usecase = ref("");
const preview = ref<PairPreview | null>(null);
const answers = ref<HearingAnswers>({});
const projectDir = ref("");
// The new folder the form offered; its note shows only while the field still holds it.
const suggestedDir = ref<string | null>(null);
const error = ref<string | null>(null);
const starting = ref(false);
const previews = latestOnly();
const suggestions = latestOnly();
const presets = ref<PresetListing[]>([]);
// Folders to pick instead of typing a path; none when they could not be read, and the field still takes any path.
const knownFolders = ref<string[]>([]);
// A chosen example waits here until its pair's interview has loaded: loading a pair clears the
// answers, so filling them any earlier would have them wiped.
const pendingPreset = ref<PresetListing | null>(null);
// The example whose answers are in the form. A pair changed by hand drops it, and with it its sample documents.
const appliedPreset = ref<PresetListing | null>(null);
// A form filled in advance — a finished build's next step, or this form as the person left it to trust its folder: it
// waits, as an example does, for its pair's interview, and then fills the folder and the answers. Taken once, on open.
const pendingFill = ref<FormFill | null>(takeFormFill());
const appliedFill = ref<FormFill | null>(null);
// What the agent writes to the person is in this language: a kept or follow-up form's, else the screen's. Documents keep
// their own.
const reportLanguage = ref<PersonLanguage>(pendingFill.value?.language ?? (isPersonLanguage(locale.value) ? locale.value : "en"));
const filledNote = useTemplateRef<HTMLElement>("filledNote");
// Where to answer Claude Code's trust prompt, when the last start was refused for want of it.
const trustIn = ref<string | null>(null);
// What personal data the copy of the source would carry, when the last start was refused to have the person look first.
const personalData = ref<Extract<Refusal, { code: "personal-data" }> | null>(null);

const bases = computed(() => basePacks(packs.value));
const usecases = computed(() => usecasesFor(packs.value, base.value));
// The task is chosen first, from every task; the base only among those the task can be built on, and not at all when
// there is one — a document task is never offered a cloud platform.
const groups = computed(() => usecaseGroups(packs.value));
const usecaseBases = computed(() => basesFor(packs.value, usecase.value));
const exampleGroups = computed(() => presetGroups(presets.value, packs.value).map((group) => ({ ...group, ...firstOfEachUsecase(group.presets) })));
// The groups whose every example is shown; the rest show one per task.
const openGroups = ref<ReadonlySet<string>>(new Set());
const toggleGroup = (base: string): void => {
  const next = new Set(openGroups.value);
  if (!next.delete(base)) next.add(base);
  openGroups.value = next;
};
// The paths some option needs that the folder has; null while unknown, and then every option is offered — the server
// still refuses one whose path is missing.
const presentPaths = ref<ReadonlySet<string> | null>(null);
const presence = latestOnly();
const hasPath = (relative: string): boolean => presentPaths.value === null || presentPaths.value.has(relative);
const formAnswers = computed(() => (preview.value ? folderAnswers(preview.value.hearing, answers.value, hasPath) : answers.value));
const settled = computed(() => (preview.value ? settledAnswers(preview.value.hearing, hasPath) : {}));
// A question the folder settles is not asked, and one it narrows offers only what can work there.
const questions = computed(() =>
  preview.value
    ? askedQuestions(preview.value.hearing, formAnswers.value)
        .filter((question) => settled.value[question.id] === undefined)
        .map((question) => (question.needsPath ? { ...question, options: offeredOptions(question, hasPath) } : question))
    : [],
);
const ready = computed(
  () =>
    !starting.value && projectDir.value.trim() !== "" && preview.value !== null && unansweredQuestions(preview.value.hearing, formAnswers.value).length === 0,
);

// The form is kept while the screen is closed, so the lists are read again when it is shown again,
// and only the newest read of each is applied.
const foldersRead = latestOnly();
const listsRead = latestOnly();

async function loadKnownFolders(): Promise<void> {
  const ticket = foldersRead.take();
  const known = await listKnownFolders();
  if (foldersRead.isLatest(ticket) && known.ok) knownFolders.value = known.value.folders;
}

/** The examples and the packs, read again; false when the packs could not be read (said on the first read only). */
async function loadLists(first: boolean): Promise<boolean> {
  const ticket = listsRead.take();
  const [listed, result] = await Promise.all([listPresets(), listPacks()]);
  if (!listsRead.isLatest(ticket)) return false;
  if (listed.ok) presets.value = listed.value.presets;
  if (!result.ok) {
    if (first) error.value = failureText(t, result);
    return false;
  }
  if (first) error.value = null;
  packs.value = result.value.packs;
  return true;
}

/** The form set up from the packs, once they could be read; until then each showing tries again. */
let setUp = false;
onOverlayShownAgain(() => {
  void loadKnownFolders();
  void rereadPreview();
  recheckPresence();
  void (setUp ? loadLists(false) : setUpForm());
});

onMounted(() => {
  void loadKnownFolders();
  void setUpForm();
});

async function setUpForm(): Promise<void> {
  if (!(await loadLists(true))) return;
  setUp = true;
  const fill = pendingFill.value;
  if (fill && !base.value) {
    projectDir.value = fill.projectDir;
    base.value = fill.base;
  }
  // Only when nothing was chosen yet: an example picked while this loaded must not be overwritten.
  if (!base.value) base.value = bases.value[0]?.slug ?? "";
}

// Each follows the other only when the pair would not fit: an example, a follow-up or a kept form sets both at once.
watch(base, (baseSlug) => {
  if (usecases.value.some((pack) => pack.slug === usecase.value)) return;
  const waiting = pendingPreset.value ?? pendingFill.value;
  usecase.value = waiting?.base === baseSlug ? waiting.usecase : (usecases.value[0]?.slug ?? "");
});
watch(usecase, () => {
  if (usecaseBases.value.some((pack) => pack.slug === base.value)) return;
  base.value = usecaseBases.value[0]?.slug ?? base.value;
});

function usePreset(preset: PresetListing): void {
  pendingPreset.value = preset;
  appliedPreset.value = null;
  pendingFill.value = null;
  void suggestFor(preset);
  // The same pair raises no watch, so its interview is read again here and the answers fill in then.
  if (base.value === preset.base && usecase.value === preset.usecase) {
    void loadPreview(preset.base, preset.usecase);
    return;
  }
  base.value = preset.base;
  usecase.value = preset.usecase;
}

// An example needs a folder of its own; when none is typed yet, offer a new one the server found a trusted place for.
async function suggestFor(preset: PresetListing): Promise<void> {
  // Taken first: a later example outdates this one's answer even when the field is no longer empty.
  const ticket = suggestions.take();
  if (projectDir.value.trim() !== "" && projectDir.value !== suggestedDir.value) return;
  // An earlier example's folder, still as the form put it, is not this example's: it goes rather than stay labelled as one.
  projectDir.value = "";
  suggestedDir.value = null;
  const result = await suggestFolder(preset.id);
  // The example must still be the one being set up: a pair changed by hand meanwhile dropped it.
  const stillThisExample = pendingPreset.value?.id === preset.id || appliedPreset.value?.id === preset.id;
  if (!suggestions.isLatest(ticket) || !stillThisExample || !result.ok || result.value.path === null || projectDir.value.trim() !== "") return;
  projectDir.value = result.value.path;
  suggestedDir.value = result.value.path;
}

function fillFromPreset(): void {
  const preset = pendingPreset.value;
  if (!preset || preset.base !== base.value || preset.usecase !== usecase.value || !preview.value) return;
  answers.value = { ...answers.value, ...preset.answers };
  appliedPreset.value = preset;
  pendingPreset.value = null;
}

function fillFromPending(): void {
  const fill = pendingFill.value;
  if (!fill || fill.base !== base.value || fill.usecase !== usecase.value || !preview.value) return;
  answers.value = { ...answers.value, ...acceptedAnswers(preview.value.hearing, fill.answers) };
  appliedFill.value = fill;
  pendingFill.value = null;
  // The example it was started from comes back with it, so its sample documents are still placed.
  appliedPreset.value = presets.value.find((known) => known.id === fill.preset && known.base === fill.base && known.usecase === fill.usecase) ?? null;
  void revealFilled();
}

// A filled form opens below every example: brought up to what was filled, or the person sees only the examples.
async function revealFilled(): Promise<void> {
  await nextTick();
  filledNote.value?.scrollIntoView({ block: "start" });
}

watch([base, usecase], ([baseSlug, usecaseSlug]) => loadPreview(baseSlug, usecaseSlug));
// Asked once typing pauses, not per keystroke.
const PRESENCE_WAIT_MS = 300;
let presenceTimer: ReturnType<typeof setTimeout> | undefined;
const shownForm = useOverlayVisible();
// A pause in typing that ends after the form is gone has no folder to ask about.
onBeforeUnmount(() => clearTimeout(presenceTimer));
watch([projectDir, preview], () => {
  clearTimeout(presenceTimer);
  const ticket = presence.take();
  presentPaths.value = null;
  const paths = preview.value ? neededPaths(preview.value.hearing) : [];
  const dir = projectDir.value.trim();
  if (paths.length === 0 || dir === "") return;
  // Typing just before a close: nothing is asked while hidden, and showing again asks.
  presenceTimer = setTimeout(() => {
    if (shownForm.value) void askPresence(dir, paths, ticket);
  }, PRESENCE_WAIT_MS);
});

async function askPresence(dir: string, paths: string[], ticket: number): Promise<void> {
  const result = await folderPresentPaths(dir, paths);
  if (presence.isLatest(ticket)) presentPaths.value = result.ok ? new Set(result.value.present) : null;
}
// The folder may have changed while the screen was closed: its paths are asked about again, keeping
// what was known until the answer comes.
function recheckPresence(): void {
  const paths = preview.value ? neededPaths(preview.value.hearing) : [];
  const dir = projectDir.value.trim();
  if (paths.length === 0 || dir === "") return;
  void askPresence(dir, paths, presence.take());
}
// A refusal names the folder it was about; another folder typed since is not the one to trust.
watch(projectDir, () => {
  trustIn.value = null;
});
// The list was of what those answers would copy; confirming it must not send answers that copy something else.
watch([answers, base, usecase], () => {
  personalData.value = null;
});

async function loadPreview(baseSlug: string, usecaseSlug: string): Promise<void> {
  // A pair changed by hand drops a waiting example: coming back to its pair later must not refill it.
  const waiting = pendingPreset.value;
  if (waiting && (waiting.base !== baseSlug || waiting.usecase !== usecaseSlug)) pendingPreset.value = null;
  const filling = pendingFill.value;
  if (filling && (filling.base !== baseSlug || filling.usecase !== usecaseSlug)) pendingFill.value = null;
  appliedPreset.value = null;
  appliedFill.value = null;
  preview.value = null;
  answers.value = {};
  error.value = null;
  // Taken before the guard: an empty pair must still outdate the preview it replaces.
  const ticket = previews.take();
  if (!baseSlug || !usecaseSlug) return;
  const result = await previewPair(baseSlug, usecaseSlug);
  if (!previews.isLatest(ticket)) return;
  preview.value = result.ok ? result.value : null;
  answers.value = result.ok ? defaultAnswers(result.value.hearing) : {};
  error.value = result.ok ? null : failureText(t, result);
  fillFromPreset();
  fillFromPending();
}

// The pair's packs may have changed while the screen was closed: the questions are read again, keeping
// every answer given (a question that is new starts from its default) and, on a failed read, the
// questions shown.
async function rereadPreview(): Promise<void> {
  const baseSlug = base.value;
  const usecaseSlug = usecase.value;
  if (!baseSlug || !usecaseSlug) return;
  // Never read (the first read failed): there are no answers to keep, so read it as a fresh pair.
  if (preview.value === null) return loadPreview(baseSlug, usecaseSlug);
  const ticket = previews.take();
  const result = await previewPair(baseSlug, usecaseSlug);
  if (!previews.isLatest(ticket) || !result.ok) return;
  preview.value = result.value;
  answers.value = { ...defaultAnswers(result.value.hearing), ...answers.value };
}

function setAnswer(id: string, answer: HearingAnswer | undefined): void {
  const others = Object.fromEntries(Object.entries(answers.value).filter(([key]) => key !== id));
  answers.value = answer === undefined ? others : { ...others, [id]: answer };
}

async function start(personalDataConfirmed = false): Promise<void> {
  if (!ready.value) return;
  starting.value = true;
  const preset = appliedPreset.value?.id;
  const result = await startRun({
    projectDir: projectDir.value.trim(),
    base: base.value,
    usecase: usecase.value,
    answers: formAnswers.value,
    ...(preset === undefined ? {} : { preset }),
    language: reportLanguage.value,
    ...(personalDataConfirmed ? { personalDataConfirmed } : {}),
  });
  starting.value = false;
  trustIn.value = !result.ok && result.refusal?.code === "untrusted" ? result.refusal.trustIn : null;
  personalData.value = !result.ok && result.refusal?.code === "personal-data" ? result.refusal : null;
  if (!result.ok) {
    error.value = failureText(t, result);
    return;
  }
  error.value = null;
  emit("started", result.value.runId);
}

// The screen is kept while closed, so the form is still filled in when the person comes back from the
// terminal: the copy kept for a reload is spent then, or it would fill a later, unrelated new build.
onOverlayShownAgain(() => {
  takeFormFill();
});

// The prompt is the person's to answer, in a terminal of their own; the form waits for them with everything in it.
function openToTrust(): void {
  if (trustIn.value === null) return;
  const preset = appliedPreset.value?.id;
  keepFormFill({
    base: base.value,
    usecase: usecase.value,
    answers: answers.value,
    projectDir: projectDir.value,
    ...(preset === undefined ? {} : { preset }),
    language: reportLanguage.value,
  });
  openTerminalAt(trustIn.value, null, "claude");
}
</script>

<template>
  <form class="flex flex-col gap-5 p-5" data-testid="blueprint-new-form" @submit.prevent="start()">
    <h2 class="m-0 font-sans text-[16px] font-[650] text-fg">{{ t("blueprints.form.title") }}</h2>

    <section v-if="presets.length" class="flex flex-col gap-2" data-testid="blueprint-presets">
      <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.form.presets") }}</h3>
      <div v-for="group in exampleGroups" :key="group.base" class="flex flex-col gap-1.5" data-testid="blueprint-preset-group">
        <h4 class="m-0 font-sans text-[12px] font-[650] text-secondary">{{ group.title }}</h4>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          <article
            v-for="preset in openGroups.has(group.base) ? group.presets : group.shown"
            :key="`${preset.usecase}/${preset.id}`"
            class="flex flex-col gap-1.5 rounded-md border border-border bg-panel p-3"
            data-testid="blueprint-preset"
          >
            <span class="font-sans text-[13px] font-[650] text-fg">{{ preset.title }}</span>
            <span class="line-clamp-3 font-sans text-[12px] text-secondary" :data-tip="preset.description" data-testid="blueprint-preset-description">{{
              preset.description
            }}</span>
            <div class="mt-auto pt-1">
              <button
                type="button"
                data-testid="blueprint-preset-use"
                class="cursor-pointer rounded-[4px] border border-border bg-base px-3 py-1 font-sans text-[12px] text-fg hover:bg-hover"
                @click="usePreset(preset)"
              >
                {{ t("blueprints.form.presetUse") }}
              </button>
            </div>
          </article>
        </div>
        <button
          v-if="group.hidden.length > 0"
          type="button"
          data-testid="blueprint-preset-more"
          class="flex cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 font-sans text-[12px] text-accent hover:underline"
          @click="toggleGroup(group.base)"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{ openGroups.has(group.base) ? "expand_less" : "expand_more" }}</span>
          {{ openGroups.has(group.base) ? t("blueprints.form.presetsFewer") : t("blueprints.form.presetsMore", { count: group.hidden.length }) }}
        </button>
      </div>
      <p v-if="appliedPreset" class="m-0 font-sans text-[12px] text-ok" data-testid="blueprint-preset-applied">
        {{ t("blueprints.form.presetApplied", { title: appliedPreset.title }) }}
      </p>
      <p v-if="appliedPreset" class="m-0 font-sans text-[12px] text-secondary" data-testid="blueprint-preset-applied-description">
        {{ appliedPreset.description }}
      </p>
      <p v-if="appliedPreset?.samples.length" class="m-0 font-sans text-[12px] text-secondary" data-testid="blueprint-preset-samples">
        {{ t("blueprints.form.presetSamples", { files: appliedPreset.samples.join(", ") }) }}
      </p>
    </section>

    <div class="flex max-w-[760px] flex-col gap-5">
      <div v-if="appliedFill" ref="filledNote">
        <p v-if="appliedFill.after" class="m-0 font-sans text-[12px] text-ok" data-testid="blueprint-follow-up">
          {{ t("blueprints.form.followUp", { title: appliedFill.after }) }}
        </p>
        <p v-else class="m-0 font-sans text-[12px] text-ok" data-testid="blueprint-form-restored">
          {{ t("blueprints.form.restored") }}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <label for="blueprint-project-dir" class="font-sans text-[13px] text-fg">{{ t("blueprints.form.projectDir") }}</label>
        <input
          id="blueprint-project-dir"
          v-model="projectDir"
          data-testid="blueprint-project-dir"
          class="w-full rounded-[4px] border border-border bg-input px-2 py-1.5 font-mono text-[12px] text-fg"
          spellcheck="false"
          list="blueprint-known-folders"
          :placeholder="knownFolders.length > 0 ? t('blueprints.form.projectDirPick') : ''"
        />
        <datalist id="blueprint-known-folders" data-testid="blueprint-known-folders">
          <option v-for="folder in knownFolders" :key="folder" :value="folder"></option>
        </datalist>
        <p
          v-if="appliedPreset !== null && suggestedDir !== null && projectDir === suggestedDir"
          class="m-0 font-sans text-[12px] text-ok"
          data-testid="blueprint-folder-suggested"
        >
          {{ t("blueprints.form.folderSuggested") }}
        </p>
        <p class="m-0 font-sans text-[11px] text-dim">{{ t("blueprints.form.projectDirHint") }}</p>
      </div>

      <div class="flex flex-wrap gap-4">
        <label class="flex flex-col gap-1 font-sans text-[13px] text-fg">
          {{ t("blueprints.form.usecase") }}
          <select
            v-model="usecase"
            data-testid="blueprint-usecase"
            class="min-w-[200px] rounded-[4px] border border-border bg-input px-2 py-1.5 text-[12px] text-fg"
          >
            <optgroup v-for="group in groups" :key="group.base ?? 'apps'" :label="group.title ?? t('blueprints.form.usecaseGroupApps')">
              <option v-for="pack in group.usecases" :key="pack.slug" :value="pack.slug">{{ pack.manifest.title }}</option>
            </optgroup>
          </select>
        </label>
        <label v-if="usecaseBases.length > 1" class="flex flex-col gap-1 font-sans text-[13px] text-fg">
          {{ t("blueprints.form.base") }}
          <select v-model="base" data-testid="blueprint-base" class="min-w-[200px] rounded-[4px] border border-border bg-input px-2 py-1.5 text-[12px] text-fg">
            <option v-for="pack in usecaseBases" :key="pack.slug" :value="pack.slug">{{ pack.manifest.title }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 font-sans text-[13px] text-fg">
          {{ t("blueprints.form.reportLanguage") }}
          <select
            v-model="reportLanguage"
            data-testid="blueprint-report-language"
            class="rounded-[4px] border border-border bg-input px-2 py-1.5 text-[12px] text-fg"
          >
            <option v-for="(name, code) in PERSON_LANGUAGE_NAMES" :key="code" :value="code">{{ name }}</option>
          </select>
        </label>
      </div>
      <p class="m-0 font-sans text-[11px] text-dim">{{ t("blueprints.form.reportLanguageHint") }}</p>
      <p v-if="packs.length > 0 && groups.length === 0" class="m-0 font-sans text-[12px] text-dim">{{ t("blueprints.form.noUsecase") }}</p>

      <template v-if="preview">
        <fieldset class="m-0 flex flex-col gap-4 border-0 p-0">
          <legend class="mb-3 font-sans text-[14px] font-[650] text-fg">{{ t("blueprints.form.questions") }}</legend>
          <BlueprintHearingField
            v-for="question in questions"
            :key="question.id"
            :question="question"
            :answer="formAnswers[question.id]"
            :project-dir="projectDir"
            @update="(answer) => setAnswer(question.id, answer)"
          />
        </fieldset>

        <details class="font-sans text-[12px] text-secondary">
          <summary class="cursor-pointer">{{ t("blueprints.form.steps") }}</summary>
          <ol class="m-0 mt-2 pl-5">
            <li v-for="step in preview.steps" :key="step.id" class="mb-0.5">{{ step.title }}</li>
          </ol>
        </details>
      </template>

      <p v-if="error" data-testid="blueprint-new-error" class="m-0 font-sans text-[12px] text-err-text">{{ error }}</p>
      <div v-if="error && trustIn" class="flex flex-col items-start gap-1" data-testid="blueprint-trust">
        <button
          type="button"
          data-testid="blueprint-open-trust"
          class="flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-border bg-base px-3 py-1.5 font-sans text-[13px] text-fg hover:bg-hover"
          @click="openToTrust"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">terminal</span>
          {{ t("blueprints.form.openToTrust") }}
        </button>
        <p class="m-0 font-sans text-[11px] text-dim">{{ t("blueprints.form.openToTrustHint", { dir: trustIn }) }}</p>
      </div>

      <div v-if="error && personalData" class="flex flex-col items-start gap-1.5" data-testid="blueprint-personal-data">
        <button
          type="button"
          data-testid="blueprint-copy-personal-data"
          class="flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-border bg-base px-3 py-1.5 font-sans text-[13px] text-fg hover:bg-hover disabled:cursor-default disabled:opacity-40"
          :disabled="!ready"
          @click="start(true)"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">policy</span>
          {{ t("blueprints.form.copyPersonalData") }}
        </button>
        <p v-if="personalData.fields.length > 0" class="m-0 font-sans text-[11px] text-dim">{{ t("blueprints.form.personalDataHint") }}</p>
      </div>

      <div>
        <button
          type="submit"
          data-testid="blueprint-start"
          class="cursor-pointer rounded-[4px] border-none bg-accent px-4 py-1.5 font-sans text-[13px] text-on-accent hover:bg-accent-bg-hover disabled:cursor-default disabled:opacity-40"
          :disabled="!ready"
        >
          {{ starting ? t("blueprints.form.starting") : t("blueprints.form.start") }}
        </button>
      </div>
    </div>
  </form>
</template>
