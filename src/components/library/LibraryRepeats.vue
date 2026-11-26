<script setup lang="ts">
// The Library's Repeats view (#3334): instructions typed again and again, most typed first, each a
// candidate for a CLAUDE.md rule or a skill. Nothing shows until the view is opened. Choosing one
// lists the conversations it was typed in last; "Make a rule" / "Make a skill" start the bundled skill
// on it, as Promote does for a conversation.
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { LibraryConversation } from "../../../common/library";
import {
  REPEAT_MIN_COUNT,
  REPEAT_MIN_SESSIONS,
  REPEAT_WINDOW_DAYS,
  type RepeatCandidate,
  type RepeatDetail,
  type RepeatTarget,
} from "../../../common/libraryRepeats";
import { loadLibraryConversation, loadLibraryRepeat, loadLibraryRepeats } from "../../composables/libraryApi";
import { whenLabel, projectName } from "./libraryRows";
import { movedIndex } from "./libraryKeys";
import { startRepeatPromote } from "./libraryPromoteStart";
import LibraryBackButton from "./LibraryBackButton.vue";

/** How many of the conversations it was typed in are listed. */
const RECENT_SESSIONS = 5;

const props = defineProps<{ query: string; now: number }>();
const emit = defineEmits<{ "open-conversation": [conversation: LibraryConversation] }>();
const { t, locale } = useI18n();

const candidates = ref<RepeatCandidate[]>([]);
/** How many there are in all; the list holds the most typed of them. */
const total = ref(0);
const loaded = ref(false);
const failed = ref(false);
const chosenId = ref<string | null>(null);
const detail = ref<RepeatDetail | null>(null);
const notice = ref<string | null>(null);
const starting = ref(false);
const readerShown = ref(false);

const matches = (candidate: RepeatCandidate, needle: string): boolean =>
  candidate.variants.some((variant) => variant.toLowerCase().includes(needle)) || candidate.projects.some((project) => project.toLowerCase().includes(needle));
const shown = computed((): RepeatCandidate[] => {
  const needle = props.query.trim().toLowerCase();
  return needle === "" ? candidates.value : candidates.value.filter((candidate) => matches(candidate, needle));
});
const selected = computed((): RepeatCandidate | null => shown.value.find((c) => c.id === chosenId.value) ?? shown.value[0] ?? null);

/** The conversations it was typed in, newest first, one row each. */
const recentSessions = computed(() => {
  const seen = new Set<string>();
  return (detail.value?.occurrences ?? []).filter((at) => !seen.has(at.sessionId) && seen.add(at.sessionId)).slice(0, RECENT_SESSIONS);
});

async function load(): Promise<void> {
  const found = await loadLibraryRepeats();
  failed.value = found === null;
  candidates.value = found?.candidates ?? [];
  total.value = found?.total ?? 0;
  loaded.value = true;
}
void load();

// The detail of the one being read; a later choice wins over an earlier one still loading.
let details = 0;
watch(
  () => selected.value?.id ?? null,
  async (id) => {
    const mine = ++details;
    detail.value = null;
    notice.value = null;
    if (id === null) return;
    const found = await loadLibraryRepeat(id);
    if (mine === details) detail.value = found;
  },
  { immediate: true },
);

const countLine = (candidate: RepeatCandidate): string =>
  t("libraryView.repeats.counts", { count: candidate.count, sessions: candidate.sessions, projects: candidate.projects.length });

function choose(id: string): void {
  chosenId.value = id;
  readerShown.value = true;
}

async function promote(target: RepeatTarget): Promise<void> {
  const candidate = selected.value;
  if (candidate === null || starting.value) return;
  starting.value = true;
  const refusal = await startRepeatPromote(candidate.id, target);
  starting.value = false;
  if (selected.value?.id === candidate.id) notice.value = refusal === null ? null : t(refusal);
}

// Only the last click opens anything: a slower answer to an earlier one is dropped.
let opens = 0;
async function openSession(sessionId: string, cwd: string | null): Promise<void> {
  const mine = ++opens;
  const conversation = await loadLibraryConversation(sessionId, cwd);
  if (mine !== opens) return;
  if (conversation === null) notice.value = t("libraryView.repeats.noConversation");
  else emit("open-conversation", conversation);
}

/** The arrow keys, from the overlay; held inside the list, as the other kinds are. */
async function move(by: number): Promise<void> {
  const list = shown.value;
  const at = selected.value === null ? -1 : list.indexOf(selected.value);
  const next = list[movedIndex(at, by, list.length)];
  if (next === undefined) return;
  chosenId.value = next.id;
  await nextTick();
  document.querySelector("[data-repeat-row][aria-current=true]")?.scrollIntoView?.({ block: "nearest" });
}

defineExpose({ move });
</script>

<template>
  <p v-if="failed" class="m-0 px-4 py-6 font-sans text-[13px] text-err-text" data-testid="repeats-failed">{{ t("libraryView.repeats.loadFailed") }}</p>
  <p v-else-if="!loaded" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" role="status">{{ t("libraryView.repeats.loading") }}</p>
  <p v-else-if="candidates.length === 0" class="m-0 px-4 py-6 font-sans text-[13px] text-dim" data-testid="repeats-empty">
    {{ t("libraryView.repeats.empty", { days: REPEAT_WINDOW_DAYS }) }}
  </p>
  <p v-else-if="shown.length === 0" class="m-0 px-4 py-6 font-sans text-[13px] text-dim">{{ t("libraryView.noMatch", { query: query.trim() }) }}</p>
  <div v-else class="flex min-h-0 flex-1 border-t border-border" data-testid="library-repeats">
    <div
      class="min-h-0 w-[360px] flex-none overflow-y-auto border-r border-border py-2 max-[760px]:w-full max-[760px]:border-r-0"
      :class="readerShown ? 'max-[760px]:hidden' : ''"
    >
      <p v-if="total > candidates.length" class="m-0 px-4 pb-1 font-sans text-[12px] text-dim" data-testid="repeats-more">
        {{ t("libraryView.repeats.more", { shown: candidates.length, total }) }}
      </p>
      <p class="m-0 px-4 pb-1 font-sans text-[12px] text-dim">
        {{ t("libraryView.repeats.intro", { days: REPEAT_WINDOW_DAYS, count: REPEAT_MIN_COUNT, sessions: REPEAT_MIN_SESSIONS }) }}
      </p>
      <button
        v-for="candidate in shown"
        :key="candidate.id"
        type="button"
        data-library-row
        data-repeat-row
        data-testid="repeat-row"
        class="block w-full cursor-pointer border-0 px-4 py-1.5 text-left font-sans"
        :class="selected?.id === candidate.id ? 'bg-selected' : 'bg-transparent hover:bg-hover'"
        :aria-current="selected?.id === candidate.id"
        @click="choose(candidate.id)"
      >
        <span class="block truncate text-[13px] text-fg">{{ candidate.text }}</span>
        <span class="block text-[12px] tabular-nums text-dim">{{ countLine(candidate) }}</span>
      </button>
    </div>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" :class="readerShown ? '' : 'max-[760px]:hidden'">
      <LibraryBackButton @click="readerShown = false" />
      <article v-if="selected" class="mx-auto w-full max-w-[760px] px-6 py-5 font-sans" data-testid="repeat-reader">
        <h2 class="m-0 whitespace-pre-wrap break-words text-[18px] font-[650] text-fg">{{ selected.text }}</h2>
        <p class="m-0 mt-1 text-[13px] tabular-nums text-dim">
          {{ countLine(selected) }} · {{ t("libraryView.repeats.last", { when: whenLabel(selected.lastAt, now, locale) }) }}
        </p>

        <section v-if="selected.variants.length > 1" class="mt-5">
          <h3 class="m-0 text-[13px] font-[650] text-dim">{{ t("libraryView.repeats.variants") }}</h3>
          <p v-for="variant in selected.variants.slice(1, 6)" :key="variant" class="m-0 mt-1 truncate text-[13px] text-secondary" data-testid="repeat-variant">
            {{ variant }}
          </p>
        </section>

        <section class="mt-5">
          <h3 class="m-0 text-[13px] font-[650] text-dim">{{ t("libraryView.repeats.sessions") }}</h3>
          <button
            v-for="occurrence in recentSessions"
            :key="occurrence.sessionId"
            type="button"
            class="mt-1 block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left font-sans text-[13px] text-accent hover:underline"
            data-testid="repeat-session"
            @click="openSession(occurrence.sessionId, occurrence.project)"
          >
            {{ projectName(occurrence.project) ?? t("libraryView.repeats.noProject") }} · {{ whenLabel(occurrence.at, now, locale) }}
          </button>
        </section>

        <div class="mt-6 flex flex-wrap items-center gap-2">
          <button
            v-for="target in ['rule', 'skill'] as const"
            :key="target"
            type="button"
            class="cursor-pointer rounded border border-border bg-base px-3 py-1.5 font-sans text-[13px] text-fg hover:bg-hover disabled:cursor-default disabled:opacity-60"
            :disabled="starting"
            :data-testid="`repeat-promote-${target}`"
            @click="promote(target)"
          >
            {{ t(`libraryView.repeats.make.${target}`) }}
          </button>
        </div>
        <p class="m-0 mt-2 text-[12px] text-dim">{{ t("libraryView.repeats.makeHint") }}</p>
        <p v-if="notice" class="m-0 mt-2 text-[13px] text-err-text" role="status" data-testid="repeat-notice">{{ notice }}</p>
      </article>
    </div>
  </div>
</template>
