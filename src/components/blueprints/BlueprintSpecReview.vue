<script setup lang="ts">
// Where the spec is settled before anything is built on it: the spec and its open questions on one
// side, a conversation on the other. Each message goes to a fresh agent session that changes the spec
// and replies; the spec shown here is re-read when the reply is in.
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { loadSpec, sendSpecMessage, type SpecView } from "../../composables/blueprintsApi";
import { latestOnly } from "./latestOnly";
import MarkdownProse from "../MarkdownProse.vue";
import BlueprintLiveActivity from "./BlueprintLiveActivity.vue";

const props = defineProps<{ runId: string; revisionSessionId: string | null; chatCount: number }>();
const emit = defineEmits<{ sent: [] }>();
const { t } = useI18n();

const view = ref<SpecView | null>(null);
const draft = ref("");
const sending = ref(false);
const error = ref<string | null>(null);
const reads = latestOnly();

async function refresh(): Promise<void> {
  const ticket = reads.take();
  const result = await loadSpec(props.runId);
  if (!reads.isLatest(ticket)) return;
  if (result.ok) view.value = result.value;
  else error.value = result.error;
}

onMounted(() => void refresh());
// The parent's poll sees a reply land (the chat grows, the revision ends); the spec is re-read then.
watch(
  () => [props.revisionSessionId, props.chatCount],
  () => void refresh(),
);

async function send(): Promise<void> {
  const message = draft.value.trim();
  if (!message || sending.value || props.revisionSessionId) return;
  sending.value = true;
  const result = await sendSpecMessage(props.runId, message);
  sending.value = false;
  error.value = result.ok ? null : result.error;
  if (!result.ok) return;
  draft.value = "";
  emit("sent");
  await refresh();
}

const outcomeKey = (outcome: string | undefined): string | null => {
  if (outcome === "no-reply") return "blueprints.spec.noReply";
  if (outcome === "lost") return "blueprints.spec.lost";
  return null;
};
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]" data-testid="blueprint-spec-review">
    <section class="flex min-w-0 flex-col gap-3">
      <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.spec.title") }}</h3>
      <div class="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-base p-4 font-sans text-[13px] text-fg" data-testid="blueprint-spec-body">
        <MarkdownProse v-if="view?.spec" :markdown="view.spec" />
        <p v-else class="m-0 font-sans text-dim">{{ t("blueprints.spec.missing") }}</p>
      </div>
      <template v-if="view?.openQuestions">
        <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.spec.openQuestions") }}</h3>
        <div class="max-h-[30vh] overflow-y-auto rounded-md border border-border bg-base p-4 font-sans text-[13px] text-fg">
          <MarkdownProse :markdown="view.openQuestions" />
        </div>
      </template>
    </section>

    <section class="flex min-w-0 flex-col gap-2">
      <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.spec.chatTitle") }}</h3>
      <div class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto" data-testid="blueprint-spec-chat">
        <p v-if="!view?.chat.length" class="m-0 font-sans text-[12px] text-dim">{{ t("blueprints.spec.empty") }}</p>
        <article
          v-for="(entry, index) in view?.chat ?? []"
          :key="`${entry.atMs}-${entry.role}-${index}`"
          class="rounded-md px-3 py-2 text-[13px]"
          :class="entry.role === 'person' ? 'ml-6 bg-accent-bg text-fg' : 'mr-6 border border-border bg-base font-sans text-fg'"
        >
          <p class="m-0 mb-1 font-sans text-[11px] text-dim">{{ entry.role === "person" ? t("blueprints.spec.you") : t("blueprints.spec.agent") }}</p>
          <p v-if="entry.role === 'person'" class="m-0 whitespace-pre-wrap font-sans">{{ entry.text }}</p>
          <p v-else-if="outcomeKey(entry.outcome)" class="m-0 font-sans text-dim">{{ t(outcomeKey(entry.outcome) ?? "") }}</p>
          <MarkdownProse v-else :markdown="entry.text" />
        </article>
        <div v-if="revisionSessionId" class="mr-6 flex flex-col gap-1.5" data-testid="blueprint-spec-revising">
          <p class="m-0 flex items-center gap-1.5 font-sans text-[12px] text-secondary">
            <span class="material-symbols-outlined animate-spin text-[14px] text-accent" aria-hidden="true">progress_activity</span>
            {{ t("blueprints.spec.revising") }}
          </p>
          <BlueprintLiveActivity :key="revisionSessionId" :session-id="revisionSessionId" />
        </div>
      </div>
      <form class="flex flex-col gap-1.5" @submit.prevent="send">
        <textarea
          v-model="draft"
          data-testid="blueprint-spec-input"
          rows="3"
          :placeholder="t('blueprints.spec.placeholder')"
          :aria-label="t('blueprints.spec.chatTitle')"
          :disabled="revisionSessionId !== null"
          class="rounded-[4px] border border-border bg-input px-2 py-1.5 font-sans text-[13px] text-fg disabled:opacity-50"
          @keydown.enter.meta.prevent="send"
          @keydown.enter.ctrl.prevent="send"
        ></textarea>
        <div class="flex items-center gap-2">
          <button
            type="submit"
            data-testid="blueprint-spec-send"
            class="cursor-pointer rounded-[4px] border-none bg-accent px-4 py-1.5 font-sans text-[13px] text-on-accent disabled:cursor-default disabled:opacity-40"
            :disabled="sending || revisionSessionId !== null || !draft.trim()"
          >
            {{ t("blueprints.spec.send") }}
          </button>
          <span class="font-sans text-[11px] text-dim">{{ t("blueprints.spec.sendHint") }}</span>
        </div>
        <p v-if="error" class="m-0 font-sans text-[12px] text-err-text" data-testid="blueprint-spec-error">{{ error }}</p>
      </form>
    </section>
  </div>
</template>
