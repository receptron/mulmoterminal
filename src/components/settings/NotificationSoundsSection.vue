<script setup lang="ts">
import { ref, watch } from "vue";
import { previewNotify } from "../../composables/useAttentionSound";
import { customSoundLabel, isCustomSound, toggledKinds, withKindSound, type SoundMap } from "../../composables/soundSettings";
import SettingsButton from "../SettingsButton.vue";
import SettingsField from "../SettingsField.vue";
import SkillLaunchButton from "../SkillLaunchButton.vue";
import { SELECT_CONTROL } from "../selectClasses";
import { SECTION_HEADING } from "./sectionClasses";
import { NOTIFY_KINDS, type NotifyKind } from "../../../common/notifyKinds";
import { presetRef, SOUND_PRESETS } from "../../../common/notifySounds";
import type { BundledSkillName } from "../../../common/bundledSkills";
import { isRecord } from "../../../common/isRecord";

const props = defineProps<{ soundFile?: string | null | undefined; soundKinds?: NotifyKind[] | undefined; sounds?: SoundMap | undefined }>();
const emit = defineEmits<{
  (e: "update-sound", file: string | null): void;
  (e: "update-sound-kinds", kinds: NotifyKind[]): void;
  (e: "update-sounds", sounds: SoundMap): void;
  (e: "launch-skill", skill: BundledSkillName): void;
}>();

// Which moments beep, and what each one plays (#873). The toolbar's speaker icon says whether to
// beep at all, this says which moments qualify.
const NOTIFY_KIND_LABEL: Record<NotifyKind, string> = {
  finished: "Turn finished",
  waiting: "Waiting for you",
  "command-done": "Command finished",
  "command-failed": "Command failed",
  "session-exited": "Session ended",
  "worker-failed": "Background worker failed",
  "pr-ci-failed": "PR CI failed",
};
const NOTIFY_KIND_HELP: Record<NotifyKind, string> = {
  finished: "the agent replied and the output is unread",
  waiting: "it stopped to ask — a permission prompt or a question",
  "command-done": "a Run cell's command exited cleanly",
  "command-failed": "a Run cell's command exited with an error, or never started",
  "session-exited": "a session's terminal ended — including when you close the cell yourself",
  "worker-failed": "a background worker ended without finishing — nothing else reports this, since it has no terminal on screen",
  "pr-ci-failed": "a directory's PR went red. Only seen while the roster is on screen, since that is what polls it",
};

const soundKindList = ref<NotifyKind[]>([...(props.soundKinds ?? [])]);
watch(
  () => props.soundKinds,
  (k) => (soundKindList.value = [...(k ?? [])]),
);
function toggleSoundKind(kind: NotifyKind) {
  soundKindList.value = toggledKinds(soundKindList.value, kind);
  emit("update-sound-kinds", soundKindList.value);
}

// Editable mirror of the saved map. It has to be a LOCAL ref and not `props.sounds`: the whole
// map is persisted on every change, so two picks made before the first POST answers would both
// compute from the same pre-save snapshot and the second would drop the first. This is the hazard
// createPresetMutations serializes writes for.
const soundMap = ref<SoundMap>({ ...(props.sounds ?? {}) });
watch(
  () => props.sounds,
  (m) => (soundMap.value = { ...(m ?? {}) }),
);

// "" is the fallback (the file below, else the chime). A kind whose saved value is a PATH —
// only settable by hand in config.json — gets an extra option so picking a preset for another
// kind can't silently drop it. The editing itself is pure, in composables/soundSettings.
const soundValue = (kind: NotifyKind): string => soundMap.value[kind] ?? "";
function setKindSound(kind: NotifyKind, value: string) {
  soundMap.value = withKindSound(soundMap.value, kind, value);
  emit("update-sounds", soundMap.value);
}
function onKindSoundChange(kind: NotifyKind, e: Event) {
  if (e.target instanceof HTMLSelectElement) setKindSound(kind, e.target.value);
}
// Preview what this kind would play, resolved the same way a real beep resolves it (the kind's
// own sound, else the fallback file, else the chime). Reads the LOCAL map so a preset picked a
// moment ago is what you hear — a preset is fetched by id and needs no saved config. Falling
// back to `soundFile` still shows the saved path, which is the only value the server can stream.
function testKindSound(kind: NotifyKind) {
  void previewNotify(kind, { kinds: soundKindList.value, sounds: soundMap.value, soundFile: props.soundFile ?? null });
}

// Custom attention sound, applied immediately (like the theme) — empty => the
// built-in chime. The text box mirrors the saved value; Browse / typing apply it.
const soundPath = ref(props.soundFile ?? "");
watch(
  () => props.soundFile,
  (f) => (soundPath.value = f ?? ""),
);

function applySound() {
  emit("update-sound", soundPath.value.trim() || null);
}
function clearSound() {
  soundPath.value = "";
  emit("update-sound", null);
}
async function browseSound() {
  try {
    const res = await fetch("/api/pick-file", { method: "POST", headers: { "content-type": "application/json" } });
    if (!res.ok) return;
    const data: unknown = await res.json();
    const picked = isRecord(data) && Array.isArray(data.paths) && typeof data.paths[0] === "string" ? data.paths[0] : "";
    if (picked) {
      soundPath.value = picked;
      applySound();
    }
  } catch {
    // native dialog unavailable / canceled — leave the field as-is
  }
}
</script>

<template>
  <h3 :class="SECTION_HEADING">Notification sounds</h3>
  <p class="mb-3 mt-1.5 text-[12px] text-dim">
    Which moments beep, and what each one plays. Running many agents at once is what turns notifications into noise — untick the ones you don't need. The
    speaker button in the toolbar silences all of them at once.
  </p>
  <div v-for="kind in NOTIFY_KINDS" :key="kind" class="py-0.5">
    <div class="flex items-center gap-2">
      <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="shrink-0 cursor-pointer"
          :checked="soundKindList.includes(kind)"
          :aria-label="`Beep when a session is ${kind}`"
          @change="toggleSoundKind(kind)"
        />
        <span class="truncate text-[12px]"
          ><strong>{{ NOTIFY_KIND_LABEL[kind] }}</strong></span
        >
      </label>
      <!-- The width lives on this wrapper, not the select: SELECT_CONTROL is `w-full`, and a
           `w-44` beside it is the same specificity — which of the two wins is decided by the
           order Tailwind emits them, not by the order written here. -->
      <div class="w-36 shrink-0">
        <select
          :value="soundValue(kind)"
          :disabled="!soundKindList.includes(kind)"
          :aria-label="`Sound for ${NOTIFY_KIND_LABEL[kind]}`"
          :class="SELECT_CONTROL"
          class="truncate"
          @change="onKindSoundChange(kind, $event)"
        >
          <option value="">Default</option>
          <option v-for="preset in SOUND_PRESETS" :key="preset.id" :value="presetRef(preset.id)">{{ preset.label }}</option>
          <option v-if="isCustomSound(soundValue(kind))" :value="soundValue(kind)">{{ customSoundLabel(soundValue(kind)) }}</option>
        </select>
      </div>
      <SettingsButton class="shrink-0" :title="`Play the ${NOTIFY_KIND_LABEL[kind]} sound`" @click="testKindSound(kind)"
        ><span class="material-symbols-outlined" aria-hidden="true">play_arrow</span></SettingsButton
      >
    </div>
    <p class="ml-6 text-[11px] text-dim">{{ NOTIFY_KIND_HELP[kind] }}</p>
  </div>

  <p class="mb-1.5 mt-3 text-[12px] text-dim">
    <strong>Default</strong> plays your own file below, or the built-in chime when that is empty. The presets are fetched once and kept on this machine, so they
    keep working offline.
  </p>
  <div class="flex items-center gap-2">
    <SettingsField
      v-model="soundPath"
      class="flex-auto font-mono"
      placeholder="/absolute/path/to/sound.wav"
      aria-label="Custom notification sound file"
      spellcheck="false"
      @change="applySound"
    />
    <SettingsButton @click="browseSound">Browse…</SettingsButton>
    <SettingsButton :disabled="!soundPath" title="Use the built-in chime" @click="clearSound">Use chime</SettingsButton>
  </div>
  <p class="mb-3 mt-3 text-[12px] text-dim">
    These are the sounds for every session. The skill also gives one project its own sound, picks which moments push to your phone, and works out which of them
    is the one waking you up.
  </p>
  <SkillLaunchButton skill="mulmoterminal-notify" icon="notifications_active" label="Configure notifications…" @launch="emit('launch-skill', $event)" />
</template>
