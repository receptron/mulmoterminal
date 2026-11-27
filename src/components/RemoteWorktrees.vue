<script setup lang="ts">
// The remote launch form's worktree section (#3506): the repo's managed worktrees on the host, each
// started, resumed or refused by the one-session rule, and a new one for a typed task. CellLaunchForm's
// section is not reused: it registers tool groups in the new tree on THIS disk first, and removes rows,
// which on the host would name a worktree outside the directory the gateway holds the request to.
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDirWorktrees, type Worktree } from "../composables/useDirLists";
import { dirKeyOf } from "../composables/dirAddress";
import { useBusyAction } from "../composables/useBusyAction";
import { worktreeAction } from "../../common/worktreeSession";
import { isRecord } from "../../common/isRecord";
import type { TerminalAgent } from "../../common/sessionAgent";
import type { RemoteHostSummary } from "../../common/remoteHosts";
import { repoWritePath } from "./remoteCell";
import { worktreeRequestFailure } from "./cellChromeRules";
import type { RemoteResume } from "./remoteLaunch";
import { LAUNCH_ROW } from "./launchFormClasses";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { isRequestTimeout } from "../utils/requestTimeout";

const { t } = useI18n();

const props = defineProps<{
  host: RemoteHostSummary;
  /** The typed directory once typing has paused, or null while it is moving or unusable. */
  repoDir: string | null;
  /** The picked agent, or null for the shell, which a worktree is not offered to. */
  agent: TerminalAgent | null;
  /** The host's workspace, where a worktree is not offered, as on this machine. */
  workspace: string | null;
}>();
const emit = defineEmits<{ (e: "start", path: string): void; (e: "resume", value: RemoteResume): void }>();

const { value: worktreeList, load: loadWorktrees } = useDirWorktrees();

const shown = computed(() => worktreeList.value.isGit && props.agent !== null && props.repoDir !== props.workspace);

const task = ref("");
const { busy, run } = useBusyAction();
const CREATE_KEY = "create";
const worktreeError = ref<string | null>(null);

watch(
  () => props.repoDir,
  (repoDir) => {
    worktreeError.value = null;
    void loadWorktrees(dirKeyOf(props.host.id, repoDir));
  },
  { immediate: true },
);

// Only while the form still names the repo the request was for, as CellLaunchForm's error line.
const reportFailure = (repoDir: string, message: string): void => {
  if (props.repoDir === repoDir) worktreeError.value = message;
};

const failureText = (e: unknown): string =>
  isRequestTimeout(e) || (e instanceof DOMException && e.name === "AbortError")
    ? t("tips.launch.remote.worktreeTimedOut", { label: props.host.label })
    : t("tips.launch.remote.worktreeUnreachable", { label: props.host.label, error: e instanceof Error ? e.message : String(e) });

async function create(): Promise<void> {
  const repoDir = props.repoDir;
  const name = task.value.trim();
  if (!repoDir || !name || props.agent === null) return;
  await run(CREATE_KEY, () => requestWorktree(repoDir, name));
}

async function requestWorktree(repoDir: string, name: string): Promise<void> {
  worktreeError.value = null;
  try {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repoDir, task: name }) };
    const res = await fetchWithTimeout(repoWritePath(props.host.id, "/api/worktrees/create", repoDir), init, SLOW_COMMAND_TIMEOUT_MS);
    if (!res.ok) return reportFailure(repoDir, worktreeRequestFailure(await jsonBody(res), res.status));
    // The body is the answer on a 200, so a read cut short must not become `{}` (CellLaunchForm says why).
    const body: unknown = await res.json();
    const path = isRecord(body) ? body.path : undefined;
    if (typeof path !== "string") return reportFailure(repoDir, t("tips.launch.remote.worktreeNoPath", { label: props.host.label }));
    task.value = "";
    emit("start", path);
  } catch (e) {
    reportFailure(repoDir, failureText(e));
  }
}

const rowHeld = (w: Worktree): boolean => worktreeAction(w.session) === "busy" || busy.value !== null;

function open(w: Worktree): void {
  const action = worktreeAction(w.session);
  if (rowHeld(w)) return;
  if (action === "resume" && w.session) emit("resume", { host: props.host.id, id: w.session.id, cwd: w.path, agent: w.session.agent });
  else emit("start", w.path);
}

const rowTitle = (w: Worktree): string => {
  const where = w.branch ?? w.path;
  const action = worktreeAction(w.session);
  if (action === "busy") return t("tips.launch.worktreeBusy", { where });
  return action === "resume" ? t("tips.launch.worktreeResume", { where }) : t("tips.launch.worktreeStart", { where });
};
</script>

<template>
  <div v-if="shown" data-testid="remote-worktrees" class="flex flex-col items-stretch gap-1.5" :class="LAUNCH_ROW">
    <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">{{ t("tips.launch.remote.worktreeHeading", { label: host.label }) }}</span>
    <div class="flex gap-1.5">
      <input
        v-model="task"
        data-testid="remote-wt-task"
        class="box-border w-auto min-w-0 flex-auto rounded-md border border-border bg-input px-2.5 py-[7px] font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
        type="text"
        :placeholder="t('tips.launch.remote.worktreeTaskPlaceholder')"
        :aria-label="t('tips.launch.worktreeTaskAria')"
        spellcheck="false"
        @keydown.enter.prevent="create"
      />
      <button
        type="button"
        data-testid="remote-wt-start"
        class="inline-flex flex-none cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-border bg-elevated px-3 py-[7px] font-sans text-[12px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-40"
        :disabled="busy !== null || !task.trim()"
        :data-tip="busy === CREATE_KEY ? t('tips.launch.worktreeCreating') : t('tips.launch.worktreeCreate')"
        @click="create"
      >
        <span class="material-symbols-outlined text-[16px]" :class="{ 'animate-spin': busy === CREATE_KEY }" aria-hidden="true">{{
          busy === CREATE_KEY ? "progress_activity" : "add"
        }}</span>
        {{ busy === CREATE_KEY ? t("tips.launch.remote.worktreeCreatingLabel") : t("tips.launch.remote.worktreeNew") }}
      </button>
    </div>
    <span v-if="worktreeError" data-testid="remote-wt-error" role="alert" class="font-sans text-[11px] leading-snug text-amber">{{ worktreeError }}</span>
    <button
      v-for="w in worktreeList.worktrees"
      :key="w.path"
      type="button"
      data-testid="remote-wt-row"
      class="min-w-0 truncate rounded-md border bg-elevated px-2.5 py-[5px] text-left font-mono text-[12px]"
      :class="[
        worktreeAction(w.session) === 'busy' ? 'border-amber text-dim' : 'border-border text-secondary',
        rowHeld(w) ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-hover hover:text-fg',
      ]"
      :disabled="rowHeld(w)"
      :data-tip="rowTitle(w)"
      @click="open(w)"
    >
      ⎇ {{ w.task }}<span v-if="w.dirty" class="ml-1.5 text-amber" :data-tip="t('tips.launch.worktreeDirty')">●</span>
      <span v-if="worktreeAction(w.session) === 'busy'" class="ml-1.5 font-sans text-[11px] text-amber">{{ t("tips.launch.remote.worktreeInUse") }}</span>
      <span v-else-if="worktreeAction(w.session) === 'resume'" class="ml-1.5 font-sans text-[11px] text-dim">{{
        t("tips.launch.remote.worktreeResumeMark")
      }}</span>
    </button>
  </div>
</template>
