<script setup lang="ts">
import { launchAgentPick } from "../composables/launchAgentPick";
// The launch form, opened at the right edge over whatever the grid is showing (#1867).
//
// WHY IT IS NOT A CELL: the grid has three view modes (docs/grid-view-modes.md) and a form placed
// as a cell means three different things — a tile that pushes its neighbours along in the tiled
// grid, a stolen enlarged slot while zoomed, and a roster row that is not even a TerminalCell.
// Sitting OVER the stage instead, as AppSettingsModal already does, is one behaviour in all three.
// It also keeps the form out of `state.cells`, so none of the "how many empty forms are open, and
// which one does `+` cancel" bookkeeping applies to it.
//
// This component owns only what the form edits (dir / agent / model choice) and forwards the four
// launch intents. Turning an intent into a cell is GridView's job, because only it can place one.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CellLaunchForm from "./CellLaunchForm.vue";
import type { AgentPick, CustomAgent } from "../../common/customAgents";
import type { AgentAccount } from "../../common/agentAccounts";
import type { CwdPreset } from "./presets";
import type { Launcher, LaunchPick } from "./launchers";
import type { LaunchChoice } from "./wsUrl";
import type { RunCommand } from "./runCommand";
import type { ResumeRequest } from "./resumeRequest";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  // The directory the form opens on: the cell the panel was opened from, or the default workspace
  // when it was opened from the toolbar with no cell in view.
  initialDir: string | null;
  defaultCwd: string | null;
  presets: CwdPreset[];
  configUnavailable?: boolean | undefined;
  launchers?: Launcher[] | undefined;
  customAgents?: CustomAgent[] | undefined;
  accounts?: AgentAccount[] | undefined;
  openSessionIds?: string[] | undefined;
  openCwds?: string[] | undefined;
}>();

const emit = defineEmits<{
  // The Agent Picker's value and the model pick ride along, which the form's own `start` does not
  // carry: in a cell both WERE the cell's own state, and here the host has to be told. Dropping
  // `choice` is silent — the cell starts on the directory's default and nothing says the pick went.
  (e: "start", value: { dir: string | null; pick: AgentPick; choice: LaunchChoice | null; account: string | null }): void;
  (e: "resume", value: ResumeRequest): void;
  (e: "run", value: RunCommand): void;
  (e: "launch", value: LaunchPick): void;
  (e: "remove-preset", value: string): void;
  // A directory can be deleted while the app is open, so the host re-checks the saved ones on every open.
  (e: "close" | "retry-config" | "opened"): void;
}>();

const dir = ref(props.initialDir ?? props.defaultCwd ?? "");
// The handed-in dir can move after the panel opens — its own missing-directory check may hide the
// saved directory it was picked from — so the field follows it until the user chooses one themselves.
const dirTouched = ref(false);
function onDir(value: string) {
  dir.value = value;
  dirTouched.value = true;
}
watch(
  () => props.initialDir ?? props.defaultCwd ?? "",
  (handedIn) => {
    if (!dirTouched.value) dir.value = handedIn;
  },
);
// The configured default every time, deliberately: the panel is mounted fresh per open (GridView
// holds it behind v-if), so the picker starts where the in-cell form starts rather than inheriting
// whatever the origin cell happens to run. Opening it on a codex cell is not a request to start
// codex.
//
// Nothing restored, so it FOLLOWS the setting: `launchPanelOpen` is a plain ref with no gate on the
// config having landed, so the panel can be opened before /api/config answers (Codex round 9).
const { pick: pickedAgent, choose: choosePickedAgent } = launchAgentPick();
const launchChoice = ref<LaunchChoice | null>(null);
const account = ref<string | null>(null);

const panel = ref<HTMLElement | null>(null);

// Escape closes it from ANYWHERE, not only from inside the panel. The panel covers the right of
// the stage and takes focus when it opens, but a click on the uncovered grid or the toolbar moves
// focus out — and a `@keydown.escape` bound to the <aside> then never fires, which is how "Escape
// closes it" ended up being said without being true (CodeRabbit, #1890).
//
// The terminal is the exception. xterm's input surface is a real textarea and Escape is meaningful
// inside it (vim, a pager); stealing it there would break the program the user is looking at.
const XTERM_INPUT_CLASS = "xterm-helper-textarea";
function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.isComposing) return;
  const target = e.target;
  if (target instanceof Element && target.classList.contains(XTERM_INPUT_CLASS)) return;
  emit("close");
}
onMounted(() => window.addEventListener("keydown", onEscape));
onBeforeUnmount(() => window.removeEventListener("keydown", onEscape));

// Where focus was when the panel opened, so closing it can put the cursor back. Taken BEFORE the
// field below steals it (codex [P2], #1890): a keyboard user who opens the panel from a terminal's
// `+` and then closes it should be back on that `+`, not dropped on the document with nothing
// selected and no way to tell where they are.
let opener: Element | null = null;

// The directory field, so Enter alone starts what is picked in the dir that was carried in. The
// panel opens on a keystroke, and a keyboard path that lands focus nowhere costs a reach for the
// mouse to use the value it just filled in for you.
onMounted(() => emit("opened"));
onMounted(async () => {
  opener = document.activeElement;
  await nextTick();
  panel.value?.querySelector<HTMLInputElement>('[data-testid="cell-dir-input"]')?.focus();
});

// Only when focus is still OURS to give back. A launch moves it on purpose (the new terminal takes
// it), and a click elsewhere means the user has already chosen where they are — putting them back
// on the `+` in either case would be the same rudeness in the other direction. `isConnected` because
// the opener can be gone by now: the cell it belonged to may have been replaced by the launch.
onBeforeUnmount(() => {
  const leaving = document.activeElement;
  const ours = leaving === null || leaving === document.body || !!panel.value?.contains(leaving);
  if (!ours) return;
  if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
});
</script>

<template>
  <aside
    ref="panel"
    class="fixed inset-y-0 right-0 z-[90] flex w-[min(520px,92vw)] flex-col overflow-y-auto border-l border-border bg-base font-sans text-fg shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
    role="dialog"
    :aria-label="t('tips.overlays.startTerminal')"
  >
    <CellLaunchForm
      :dir="dir"
      :agent="pickedAgent"
      :choice="launchChoice"
      :default-cwd="defaultCwd"
      :presets="presets"
      :config-unavailable="configUnavailable === true"
      :launchers="launchers"
      :custom-agents="customAgents ?? []"
      :accounts="accounts ?? []"
      :account="account"
      :open-session-ids="openSessionIds"
      :open-cwds="openCwds"
      :cancellable="true"
      @update:dir="onDir"
      @update:agent="choosePickedAgent"
      @update:choice="(value) => (launchChoice = value)"
      @update:account="(value) => (account = value)"
      @start="(value) => emit('start', { dir: value, pick: pickedAgent, choice: launchChoice, account })"
      @resume="(value) => emit('resume', value)"
      @run="(value) => emit('run', value)"
      @launch="(value) => emit('launch', value)"
      @remove-preset="(value) => emit('remove-preset', value)"
      @retry-config="emit('retry-config')"
      @close="emit('close')"
    />
  </aside>
</template>
