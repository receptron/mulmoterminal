<script setup lang="ts">
// A file that is not text: drawn when it is a picture, a video, a sound or a PDF, named otherwise,
// and offered to the OS either way.
import type { FileMediaKind } from "./filePreviewKind";
import FilesMediaView from "./FilesMediaView.vue";

// `canOpen` false where the file is on another machine, whose OS this one cannot hand it to.
withDefaults(defineProps<{ kind: FileMediaKind | null; src: string; name: string; message: string; canOpen?: boolean }>(), { canOpen: true });
const emit = defineEmits<{ "open-in-os": [] }>();
</script>

<template>
  <div
    class="flex flex-col items-center gap-2 p-4 text-center"
    :class="kind === 'pdf' ? 'min-h-0 flex-auto self-stretch' : 'm-auto'"
    data-testid="files-unpreviewable"
  >
    <FilesMediaView v-if="kind" :kind="kind" :src="src" :name="name" />
    <template v-else>
      <span class="material-symbols-outlined text-[28px] text-muted" aria-hidden="true">draft</span>
      <p class="text-[13px] text-muted">{{ message }}</p>
    </template>
    <button
      v-if="canOpen"
      type="button"
      class="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] text-fg hover:bg-hover"
      data-testid="files-open-in-os"
      @click="emit('open-in-os')"
    >
      <span class="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span>
      Open in OS
    </button>
  </div>
</template>
