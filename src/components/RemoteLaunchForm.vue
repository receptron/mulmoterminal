<script setup lang="ts">
// The launch form for a remote host (#3506): a directory, typed or picked from the remote's own saved
// ones, and a built-in agent or the shell — or one of that agent's past conversations there, resumed.
// CellLaunchForm is not reused with a flag: every directory it lists and checks is on THIS disk.
import { computed, onUnmounted, ref, watch } from "vue";
import { useRemoteHostDirs } from "../composables/useRemoteHostDirs";
import { useI18n } from "vue-i18n";
import { AGENT_PICKER_OPTIONS } from "./agentPicker";
import { isLaunchAgent, type LaunchAgent } from "../../common/launchAgent";
import { remoteDirOf, type RemoteResume, type RemoteStart } from "./remoteLaunch";
import { useResumableSessions, type ResumableSession } from "../composables/useDirLists";
import { dirKeyOf } from "../composables/dirAddress";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent";
import { LAUNCH_ROW } from "./launchFormClasses";
import type { RemoteHostSummary } from "../../common/remoteHosts";

const { t } = useI18n();

const props = defineProps<{ host: RemoteHostSummary }>();
const emit = defineEmits<{ (e: "start", value: RemoteStart): void; (e: "resume", value: RemoteResume): void; (e: "close"): void }>();

const AGENTS = AGENT_PICKER_OPTIONS.flatMap((option) => (isLaunchAgent(option.agent) ? [{ agent: option.agent, label: option.label }] : []));

const dir = ref("");
const { dirs, error: dirsError } = useRemoteHostDirs(props.host.id);
// The remote's workspace fills the field, as the local form opens on this machine's — unless the
// user has typed something by the time it answers.
watch(dirs, (answer) => {
  if (answer?.cwd && dir.value === "") dir.value = answer.cwd;
});
const chips = computed(() => {
  const answer = dirs.value;
  if (!answer) return [];
  const workspace = answer.cwd ? [{ label: t("tips.launch.remote.workspace"), path: answer.cwd }] : [];
  return [...workspace, ...answer.presets.filter((preset) => preset.path !== answer.cwd)];
});
const agent = ref<LaunchAgent>("claude");
const startable = computed(() => remoteDirOf(dir.value) !== null);
const showDirHint = computed(() => dir.value.trim() !== "" && !startable.value);

function start() {
  if (startable.value) emit("start", { host: props.host.id, dir: dir.value, agent: agent.value });
}

// The picked agent's own past conversations in the typed directory, read on the host. A shell has none.
const listAgent = computed<TerminalAgent | null>(() => (isTerminalAgent(agent.value) ? agent.value : null));
const { value: resumable, forget: forgetResumable, load: loadResumable } = useResumableSessions();
const RESUME_RELOAD_DEBOUNCE_MS = 300;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
// The rows go the moment the directory or the agent changes, since they are the previous one's; the
// reload waits out the typing.
watch([dir, listAgent], () => {
  clearTimeout(reloadTimer);
  forgetResumable();
  reloadTimer = setTimeout(() => {
    const listed = listAgent.value;
    void loadResumable(listed === null ? null : dirKeyOf(props.host.id, remoteDirOf(dir.value)), listed ?? "claude");
  }, RESUME_RELOAD_DEBOUNCE_MS);
});
onUnmounted(() => clearTimeout(reloadTimer));

// Held by a terminal somewhere — this grid's own remote cells included, since the gateway's socket is
// one the remote counts. Opening it here would take it from whoever has it.
const heldElsewhere = (session: ResumableSession): boolean => session.attached === true;

function resume(session: ResumableSession): void {
  const cwd = resumable.value.cwd;
  if (heldElsewhere(session) || listAgent.value === null || !cwd) return;
  // A row still running is picked up under the key it runs under, as CellLaunchForm's resume explains.
  emit("resume", { host: props.host.id, id: session.runningKey ?? session.id, cwd, agent: listAgent.value });
}
</script>

<template>
  <form data-testid="remote-launch" class="flex flex-col items-center gap-3 p-4" @submit.prevent="start">
    <button
      type="button"
      data-testid="cell-launch-cancel"
      class="absolute right-1.5 top-1.5 inline-flex h-[26px] w-7 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-[16px] leading-none text-secondary hover:bg-[var(--err-hover-bg)] hover:text-err-text"
      :data-tip="t('tips.launch.cancel')"
      :aria-label="t('tips.launch.cancel')"
      @click="emit('close')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
    <label :class="LAUNCH_ROW" class="flex flex-col gap-1 text-[12px] text-secondary">
      {{ t("tips.launch.remote.dirLabel", { label: host.label }) }}
      <input
        v-model="dir"
        data-testid="cell-dir-input"
        class="box-border w-full rounded-md border border-border bg-input px-2.5 py-[7px] font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
        :placeholder="t('tips.launch.remote.dirPlaceholder')"
        spellcheck="false"
        autocomplete="off"
      />
      <span v-if="showDirHint" data-testid="remote-dir-hint" class="font-sans text-[11px] leading-snug text-amber">{{
        t("tips.launch.remote.dirNeedsAbsolute", { label: host.label })
      }}</span>
    </label>
    <div v-if="chips.length" class="flex w-full flex-wrap justify-center gap-1.5">
      <button
        v-for="chip in chips"
        :key="chip.path"
        type="button"
        data-testid="remote-dir-chip"
        class="cursor-pointer rounded-[14px] border border-border bg-transparent px-2.5 py-1 font-sans text-[12px] text-secondary hover:bg-hover hover:text-fg"
        :data-tip="chip.path"
        :aria-label="t('tips.launch.remote.chipFill', { path: chip.path })"
        @click="dir = chip.path"
      >
        {{ chip.label }}
      </button>
    </div>
    <p v-if="dirsError" data-testid="remote-dirs-error" role="status" :class="LAUNCH_ROW" class="font-sans text-[11px] leading-snug text-amber">
      {{ t("tips.launch.remote.dirsFailed", { label: host.label, error: dirsError }) }}
    </p>
    <div :class="LAUNCH_ROW" class="flex flex-wrap gap-1.5" role="radiogroup">
      <button
        v-for="option in AGENTS"
        :key="option.agent"
        type="button"
        role="radio"
        :data-testid="`remote-agent-${option.agent}`"
        :aria-checked="agent === option.agent"
        class="cursor-pointer rounded-md border px-2.5 py-1 text-[12px]"
        :class="agent === option.agent ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-transparent text-secondary hover:text-fg'"
        @click="agent = option.agent"
      >
        {{ option.label }}
      </button>
    </div>
    <button
      type="submit"
      data-testid="remote-start"
      class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-elevated px-3 py-1 text-[12px] text-secondary enabled:hover:border-accent enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
      :disabled="!startable"
    >
      <span class="material-symbols-outlined text-[18px]" aria-hidden="true">play_arrow</span>
      {{ t("tips.launch.remote.start", { label: host.label }) }}
    </button>
    <div v-if="resumable.sessions.length" data-testid="remote-resume" :class="LAUNCH_ROW" class="flex flex-col items-center gap-1.5">
      <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">{{ t("tips.launch.remote.resumeHeading", { label: host.label }) }}</span>
      <div class="flex w-full flex-col gap-1">
        <button
          v-for="session in resumable.sessions"
          :key="session.id"
          type="button"
          data-testid="remote-resume-item"
          class="flex w-full min-w-0 items-baseline justify-between gap-2 rounded-md border bg-deep px-2.5 py-[5px] text-left font-sans text-[12px]"
          :class="
            heldElsewhere(session)
              ? 'cursor-not-allowed border-amber text-dim'
              : 'cursor-pointer border-border text-secondary hover:border-accent hover:bg-elevated'
          "
          :disabled="heldElsewhere(session)"
          :data-tip="heldElsewhere(session) ? t('tips.launch.sessionBusy', { title: session.title }) : session.title"
          @click="resume(session)"
        >
          <span class="truncate">{{ session.title }}</span>
          <span v-if="heldElsewhere(session)" class="flex-none whitespace-nowrap text-[11px] text-amber">{{ t("tips.launch.remote.resumeOpen") }}</span>
        </button>
      </div>
    </div>
    <p :class="LAUNCH_ROW" class="text-[11px] text-secondary">{{ t("tips.launch.remote.localOnly", { label: host.label }) }}</p>
  </form>
</template>
