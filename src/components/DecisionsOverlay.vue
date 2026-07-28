<script setup lang="ts">
// Full-screen decision log, a sibling of PrsOverlay. Shows what a human was asked in this project
// and what they chose, from GET /api/decisions — read-only, and nothing here writes anything.
//
// The three answer kinds are the point of the screen, not decoration: an answer the user WROTE
// rather than chose is evidence the question was wrong, and one never answered is evidence it
// should not have been asked then. Both are easy to lose in a flat list, so each is filterable and
// visually distinct (#991, #1008).
import { computed, ref, watch } from "vue";
import type { DecisionsResponse } from "../../common/decisionLog";
import { useDecisionsView } from "../composables/useDecisionsView";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import { useAppConfig } from "../composables/useAppConfig";
import { relativeTimeFromIso } from "./cellDisplay";
import { answerKindText, decisionRows, emptyStateText, filterRows, isChosen, kindCounts, unreadableNote, type DecisionFilter } from "./decisionRows";

const { isOpen, cwd, close } = useDecisionsView();
const { defaultCwd } = useAppConfig();

const answer = ref<DecisionsResponse>({ decisions: [], scanned: 0, unreadable: 0 });
// Stamped when a load returns rather than read per render: every row's "3 hours ago" is then
// relative to one instant, and the list does not re-render on every tick.
const now = ref(Date.now());
const loading = ref(false);
const error = ref<string | null>(null);
const filter = ref<DecisionFilter>("all");
let reqId = 0;

// The route's ?cwd= when a terminal header opened it; the server's workspace when the toolbar did.
const projectDir = computed(() => cwd.value ?? defaultCwd.value);

const rows = computed(() => decisionRows(answer.value.decisions));
const counts = computed(() => kindCounts(rows.value));
const shown = computed(() => filterRows(rows.value, filter.value));
const note = computed(() => unreadableNote(answer.value.unreadable));

const FILTERS: { key: DecisionFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "option", label: "Chose an option" },
  { key: "free-text", label: "Wrote their own" },
  { key: "unanswered", label: "Never answered" },
];

const filterCount = (key: DecisionFilter): number => (key === "all" ? rows.value.length : counts.value[key]);

async function load(): Promise<void> {
  const dir = projectDir.value;
  const mine = ++reqId;
  loading.value = true;
  error.value = null;
  try {
    const query = dir ? `?cwd=${encodeURIComponent(dir)}` : "";
    const res = await fetch(`/api/decisions${query}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: DecisionsResponse = await res.json();
    if (mine !== reqId) return; // a newer request already answered
    answer.value = data;
    now.value = Date.now();
  } catch (e) {
    if (mine !== reqId) return;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === reqId) loading.value = false;
  }
}

// `immediate` because the overlay mounts already open when the route was entered directly, and a
// change-only watcher would then render an empty log and never ask for anything.
watch([isOpen, projectDir], ([open]) => open && void load(), { immediate: true });

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Decisions">
    <header class="flex flex-none flex-wrap items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <span class="text-[14px] font-[650] text-fg">Decisions</span>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="loading"
        title="Reload"
        aria-label="Reload decisions"
        @click="load"
      >
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
      <span v-if="loading" class="text-[12px] text-muted">Loading…</span>
      <div class="flex items-center gap-1" role="group" aria-label="Filter by how it was answered">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="cursor-pointer rounded-[10px] border px-2 py-px text-[11px]"
          :class="filter === f.key ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'"
          :aria-pressed="filter === f.key"
          @click="filter = f.key"
        >
          {{ f.label }} {{ filterCount(f.key) }}
        </button>
      </div>
    </header>

    <div class="flex-auto overflow-y-auto px-4 pb-16 pt-3">
      <p v-if="error" class="px-1 py-2 text-[13px] text-err-text">Could not read decisions: {{ error }}</p>
      <p v-if="note" class="px-1 py-2 text-[12px] text-muted">{{ note }}</p>

      <p v-if="!loading && !error && rows.length === 0" class="px-1 py-6 text-[13px] text-muted">
        {{ emptyStateText(answer.scanned, answer.unreadable) }}
      </p>
      <p v-else-if="!loading && shown.length === 0" class="px-1 py-6 text-[13px] text-muted">Nothing matches this filter.</p>

      <article
        v-for="row in shown"
        :key="row.key"
        class="mb-3 rounded-md border border-border bg-panel px-3 py-2.5"
        :class="row.question.answerKind === 'free-text' ? 'border-l-[3px] border-l-accent' : ''"
      >
        <div class="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-dim">
          <span>{{ relativeTimeFromIso(row.ts, now) }}</span>
          <span v-if="row.question.header" class="rounded-[10px] border border-border px-1.5 py-px text-muted">{{ row.question.header }}</span>
          <span :class="row.question.answerKind === 'free-text' ? 'text-accent' : 'text-dim'">{{ answerKindText(row.question.answerKind) }}</span>
          <span v-if="row.question.multiSelect">multi-select</span>
        </div>

        <p class="mb-2 text-[13px] text-fg">{{ row.question.question }}</p>

        <ul v-if="row.question.options.length" class="mb-2 flex flex-col gap-1">
          <li
            v-for="opt in row.question.options"
            :key="opt.label"
            class="rounded border border-border px-2 py-1 text-[12px]"
            :class="isChosen(row.question, opt.label) ? 'border-accent text-fg' : 'text-muted'"
          >
            <span class="font-[600]">{{ opt.label }}</span>
            <span v-if="opt.description" class="text-dim"> — {{ opt.description }}</span>
          </li>
        </ul>

        <p v-if="row.question.answer" class="text-[12px]">
          <span class="text-dim">Answer: </span>
          <span :class="row.question.answerKind === 'free-text' ? 'text-accent' : 'text-secondary'">{{ row.question.answer }}</span>
        </p>
      </article>
    </div>
  </div>
</template>
