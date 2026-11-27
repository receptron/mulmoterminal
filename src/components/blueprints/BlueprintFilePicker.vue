<script setup lang="ts">
// Picking a question's files from the build's folder, rather than typing each path: clicking a file adds or removes
// its line in the answer.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { listFolderFiles } from "../../composables/blueprintsApi";
import { answerLines, fitsOnALine, toggleLine } from "./blueprintView";
import { failureText } from "./refusalText";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";

const props = defineProps<{ projectDir: string; answer: string }>();
const emit = defineEmits<{ update: [answer: string | undefined] }>();
const { t } = useI18n();

// The folder the list was read from: typing another folder hides it rather than offering the old one's files.
const listedFor = ref<string | null>(null);
const files = ref<string[]>([]);
const more = ref(false);
const error = ref<string | null>(null);
const loading = ref(false);

const folder = computed(() => props.projectDir.trim());
const open = computed(() => listedFor.value !== null && listedFor.value === folder.value);
const chosen = computed(() => new Set(answerLines(props.answer)));

let reads = 0;
async function show(): Promise<void> {
  const dir = folder.value;
  if (dir === "" || loading.value) return;
  const mine = ++reads;
  loading.value = true;
  const result = await listFolderFiles(dir);
  loading.value = false;
  if (mine !== reads) return;
  error.value = result.ok ? null : failureText(t, result);
  files.value = result.ok ? result.value.files.filter(fitsOnALine) : [];
  more.value = result.ok && result.value.more;
  listedFor.value = dir;
}

// The form is kept while the screen is closed, and the folder's files may have changed: an open list is
// read again, and a read that fails then keeps the one shown.
async function reread(): Promise<void> {
  const dir = listedFor.value;
  if (!open.value || dir === null) return;
  const mine = ++reads;
  const result = await listFolderFiles(dir);
  if (mine !== reads || !result.ok) return;
  error.value = null;
  files.value = result.value.files.filter(fitsOnALine);
  more.value = result.value.more;
}
onOverlayShownAgain(() => void reread());

function toggle(file: string): void {
  const next = toggleLine(props.answer, file);
  emit("update", next === "" ? undefined : next);
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="blueprint-file-picker">
    <div class="flex items-center gap-2">
      <button
        type="button"
        data-testid="blueprint-pick-files"
        class="flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-border bg-base px-2.5 py-1 font-sans text-[12px] text-fg hover:bg-hover disabled:cursor-default disabled:opacity-40"
        :disabled="folder === '' || loading"
        @click="show"
      >
        <span class="material-symbols-outlined text-[15px]" aria-hidden="true">folder_open</span>{{ t("blueprints.form.pickFiles") }}
      </button>
      <span v-if="folder === ''" class="font-sans text-[11px] text-dim">{{ t("blueprints.form.pickNeedsFolder") }}</span>
    </div>
    <p v-if="open && error" class="m-0 font-sans text-[12px] text-err-text">{{ error }}</p>
    <p v-else-if="open && files.length === 0" class="m-0 font-sans text-[12px] text-secondary" data-testid="blueprint-pick-none">
      {{ t("blueprints.form.pickNone") }}
    </p>
    <div v-else-if="open" class="flex flex-wrap gap-1.5">
      <button
        v-for="file in files"
        :key="file"
        type="button"
        data-testid="blueprint-pick-file"
        :aria-pressed="chosen.has(file)"
        class="cursor-pointer rounded-[4px] border px-2 py-0.5 font-mono text-[11px]"
        :class="chosen.has(file) ? 'border-accent bg-accent-bg text-fg' : 'border-border bg-base text-secondary hover:bg-hover'"
        @click="toggle(file)"
      >
        {{ file }}
      </button>
    </div>
    <p v-if="open && more" class="m-0 font-sans text-[11px] text-dim">{{ t("blueprints.form.pickMore") }}</p>
  </div>
</template>
