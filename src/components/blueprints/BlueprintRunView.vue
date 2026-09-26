<script setup lang="ts">
// One build: every step with where it stands, and — for the step it is on — the one thing the person
// can do there. Approving, answering and retrying are the only moves the executor waits for; while
// an agent is working this only says so.
import { computed, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { loadRun, sendEvent, type PersonEvent } from "../../composables/blueprintsApi";
import { currentStep } from "../../../common/blueprint/state";
import type { BlueprintRunView } from "../../../common/blueprint/run";
import { elapsedParts, gateKey, rejectionReason, stepLook } from "./blueprintView";
import { latestOnly } from "./latestOnly";
import BlueprintLiveActivity from "./BlueprintLiveActivity.vue";
import BlueprintSpecReview from "./BlueprintSpecReview.vue";
import MarkdownProse from "../MarkdownProse.vue";

const props = defineProps<{ runId: string }>();
const { t } = useI18n();

// Fast enough that an approval visibly moves the build on; a step takes minutes, not seconds.
const RUN_POLL_MS = 2000;
const SPEC_FILE = ".blueprint/spec.md";

const view = ref<BlueprintRunView | null>(null);
const loadError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const sending = ref(false);
const answer = ref("");
const rejectReason = ref("");
// Polls and a person's actions share one sequence, so a poll sent before an action cannot land after it.
const reads = latestOnly();

const current = computed(() => (view.value ? currentStep(view.value.run.steps, view.value.state) : null));
const currentState = computed(() => (view.value && current.value ? view.value.state.steps[current.value.id] : undefined));
const reviewing = computed(() => current.value?.gates.includes("review") ?? false);

// The session working on the step right now, if one is: what the live panel and the clock follow.
const activeSession = computed(() => {
  const run = view.value?.run;
  if (!run?.activeSessionId) return null;
  return [...run.sessions].reverse().find((entry) => entry.sessionId === run.activeSessionId) ?? null;
});

// Ticks once a second so the elapsed time moves between polls.
const CLOCK_TICK_MS = 1000;
const now = ref(Date.now());
const clockTimer = setInterval(() => (now.value = Date.now()), CLOCK_TICK_MS);
onUnmounted(() => clearInterval(clockTimer));
const elapsed = computed(() => (activeSession.value ? elapsedParts(activeSession.value.atMs, now.value) : null));

async function refresh(): Promise<void> {
  // The server does not queue reads behind a person's action, so a read sent mid-action can see
  // the state from before it — and, being newer, would win. The action's own answer is the read.
  if (sending.value) return;
  const ticket = reads.take();
  const result = await loadRun(props.runId);
  if (!reads.isLatest(ticket)) return;
  if (result.ok) {
    view.value = result.value;
    loadError.value = null;
  } else loadError.value = result.error;
}

void refresh();
const pollTimer = setInterval(() => void refresh(), RUN_POLL_MS);
onUnmounted(() => clearInterval(pollTimer));

async function act(event: PersonEvent): Promise<void> {
  const step = current.value;
  if (!step || sending.value) return;
  sending.value = true;
  const ticket = reads.take();
  const result = await sendEvent(props.runId, step.id, event);
  sending.value = false;
  actionError.value = result.ok ? null : result.error;
  if (!result.ok) return;
  answer.value = "";
  rejectReason.value = "";
  // A poll sent after this action knows at least as much; only an older answer is dropped.
  if (reads.isLatest(ticket)) view.value = result.value;
}

const statusOf = (stepId: string) => view.value?.state.steps[stepId]?.status ?? "pending";
</script>

<template>
  <div class="flex flex-col gap-5 p-5" data-testid="blueprint-run">
    <p v-if="loadError && !view" class="m-0 font-sans text-[13px] text-err-text">{{ t("blueprints.loadError") }} {{ loadError }}</p>

    <template v-if="view">
      <p class="m-0 font-sans text-[12px] text-dim">
        {{ t("blueprints.run.projectDir") }}: <span class="font-mono text-secondary">{{ view.run.projectDir }}</span>
      </p>

      <section v-if="current" class="flex max-w-[1280px] flex-col gap-3 rounded-md border border-border bg-panel p-4" data-testid="blueprint-current">
        <h2 class="m-0 flex items-center gap-2 font-sans text-[15px] font-[650] text-fg">
          <span
            class="material-symbols-outlined text-[18px]"
            :class="[stepLook(statusOf(current.id)).tone, stepLook(statusOf(current.id)).motion]"
            aria-hidden="true"
            >{{ stepLook(statusOf(current.id)).icon }}</span
          >
          {{ current.title }}
          <span class="font-sans text-[12px] font-normal text-secondary">{{ t(stepLook(statusOf(current.id)).labelKey) }}</span>
          <span v-if="elapsed" class="font-sans text-[12px] font-normal text-dim" data-testid="blueprint-elapsed">{{
            t("blueprints.run.elapsed", { minutes: elapsed.minutes, seconds: elapsed.seconds })
          }}</span>
        </h2>
        <p v-if="current.description" class="m-0 font-sans text-[13px] text-secondary">{{ current.description }}</p>

        <template v-if="currentState?.status === 'awaiting-approval'">
          <ul class="m-0 flex flex-col gap-1 pl-5 font-sans text-[13px] text-fg">
            <li v-for="gate in current.gates" :key="gate">{{ t(gateKey(gate)) }}</li>
          </ul>
          <BlueprintSpecReview
            v-if="reviewing"
            :run-id="runId"
            :revision-session-id="view.run.revisionSessionId"
            :chat-count="view.run.specChat.length"
            @sent="refresh"
          />
          <p v-if="reviewing" class="m-0 font-sans text-[11px] text-dim">
            {{ t("blueprints.run.specFile", { file: `${view.run.projectDir}/${SPEC_FILE}` }) }}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="blueprint-approve"
              class="cursor-pointer rounded-[4px] border-none bg-accent px-4 py-1.5 font-sans text-[13px] text-on-accent disabled:opacity-40"
              :disabled="sending || view.run.revisionSessionId !== null"
              @click="act({ type: 'approve' })"
            >
              {{ t("blueprints.run.approve") }}
            </button>
            <input
              v-model="rejectReason"
              data-testid="blueprint-reject-reason"
              :placeholder="t('blueprints.run.rejectReason')"
              class="min-w-[260px] flex-1 rounded-[4px] border border-border bg-input px-2 py-1.5 font-sans text-[12px] text-fg"
            />
            <button
              type="button"
              data-testid="blueprint-reject"
              class="cursor-pointer rounded-[4px] border border-border bg-base px-3 py-1.5 font-sans text-[12px] text-secondary hover:bg-hover disabled:opacity-40"
              :disabled="sending || !rejectReason.trim()"
              @click="act({ type: 'reject', reason: rejectReason.trim() })"
            >
              {{ t("blueprints.run.reject") }}
            </button>
          </div>
        </template>

        <form
          v-else-if="currentState?.status === 'awaiting-answer'"
          class="flex flex-col gap-2"
          @submit.prevent="act({ type: 'answer', answer: answer.trim() })"
        >
          <!-- Markdown: a question that walks a person through a console carries numbered steps and links. -->
          <div class="font-sans text-[13px] text-fg" data-testid="blueprint-question-text">
            <MarkdownProse :markdown="currentState.question ?? ''" />
          </div>
          <textarea
            v-model="answer"
            data-testid="blueprint-answer"
            rows="3"
            :placeholder="t('blueprints.run.answerPlaceholder')"
            :aria-label="t('blueprints.run.answer')"
            class="rounded-[4px] border border-border bg-input px-2 py-1.5 font-sans text-[13px] text-fg"
          ></textarea>
          <div>
            <button
              type="submit"
              data-testid="blueprint-send-answer"
              class="cursor-pointer rounded-[4px] border-none bg-accent px-4 py-1.5 font-sans text-[13px] text-on-accent disabled:opacity-40"
              :disabled="sending || !answer.trim()"
            >
              {{ t("blueprints.run.send") }}
            </button>
          </div>
        </form>

        <template v-else-if="currentState?.status === 'failed'">
          <p v-if="rejectionReason(currentState)" class="m-0 font-sans text-[13px] text-err-text">{{ rejectionReason(currentState) }}</p>
          <details v-if="currentState.lastCheck && !currentState.lastCheck.ok" open class="font-sans text-[12px] text-secondary">
            <summary class="cursor-pointer">{{ t("blueprints.run.checkOutput") }}</summary>
            <pre class="m-0 mt-2 max-h-[320px] overflow-auto rounded-[4px] bg-base p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">{{
              currentState.lastCheck.output
            }}</pre>
          </details>
          <div>
            <button
              type="button"
              data-testid="blueprint-retry"
              class="cursor-pointer rounded-[4px] border border-border bg-base px-4 py-1.5 font-sans text-[13px] text-fg hover:bg-hover disabled:opacity-40"
              :disabled="sending"
              @click="act({ type: 'retry' })"
            >
              {{ t("blueprints.run.retry") }}
            </button>
          </div>
        </template>

        <template v-else>
          <p class="m-0 font-sans text-[13px] text-secondary">{{ t("blueprints.run.working") }}</p>
          <BlueprintLiveActivity v-if="activeSession" :key="activeSession.sessionId" :session-id="activeSession.sessionId" />
        </template>

        <p v-if="actionError" data-testid="blueprint-action-error" class="m-0 font-sans text-[12px] text-err-text">{{ actionError }}</p>
      </section>

      <p v-else class="m-0 font-sans text-[14px] text-ok" data-testid="blueprint-finished">{{ t("blueprints.run.finished") }}</p>

      <section class="flex flex-col gap-1">
        <h3 class="m-0 mb-1 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.run.steps") }}</h3>
        <ol class="m-0 flex list-none flex-col gap-0.5 p-0">
          <li
            v-for="step in view.run.steps"
            :key="step.id"
            data-testid="blueprint-step"
            class="flex items-center gap-2 rounded-[4px] px-2 py-1 font-sans text-[13px]"
            :class="current?.id === step.id ? 'bg-hover text-fg' : 'text-secondary'"
          >
            <span
              class="material-symbols-outlined text-[16px]"
              :class="[stepLook(statusOf(step.id)).tone, stepLook(statusOf(step.id)).motion]"
              aria-hidden="true"
              >{{ stepLook(statusOf(step.id)).icon }}</span
            >
            <span class="flex-1 truncate">{{ step.title }}</span>
            <span v-if="step.gates.length" class="material-symbols-outlined text-[14px] text-dim" aria-hidden="true">front_hand</span>
            <span class="text-[11px] text-dim">{{ t(stepLook(statusOf(step.id)).labelKey) }}</span>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>
