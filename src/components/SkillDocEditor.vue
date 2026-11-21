<script setup lang="ts">
// Editing one skill's SKILL.md in the Skills viewer (#3332): the whole file, frontmatter and all, saved
// only over the text it was opened on. ⌘Enter saves; Esc cancels the edit, not the viewer.
import { nextTick, onMounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import type { SkillSource } from "../../common/skillCatalog";
import { saveSkillDoc } from "../composables/useSkillCatalog";
import { isImeConfirming } from "../composables/imeComposition";

const props = defineProps<{ source: SkillSource; slug: string; text: string; version: string }>();
const emit = defineEmits<{ (e: "saved", text: string, version: string): void; (e: "cancel" | "reload"): void }>();
const { t } = useI18n();
const draft = ref(props.text);
const saving = ref(false);
const notice = ref<"changed" | "failed" | null>(null);
const field = useTemplateRef<HTMLTextAreaElement>("field");

onMounted(async () => {
  await nextTick();
  field.value?.focus();
});

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  const result = await saveSkillDoc(props.source, props.slug, draft.value, props.version);
  saving.value = false;
  if (result.kind === "saved") emit("saved", draft.value, result.version);
  else notice.value = result.kind;
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    if (isImeConfirming(event)) return;
    event.preventDefault();
    if (!saving.value) emit("cancel");
  } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !isImeConfirming(event)) {
    event.preventDefault();
    event.stopPropagation();
    void save();
  }
}
</script>

<template>
  <div class="flex min-h-[60vh] flex-col" data-testid="skill-editor" @keydown="onKey">
    <textarea
      ref="field"
      v-model="draft"
      class="min-h-0 flex-1 resize-none rounded border border-border bg-transparent p-3 font-mono text-[13px] leading-[1.6] text-fg outline-none focus:border-accent"
      :aria-label="t('skillsView.edit.label')"
      spellcheck="false"
      data-testid="skill-editor-field"
      :readonly="saving"
    ></textarea>
    <footer class="mt-2 flex flex-wrap items-center justify-end gap-2">
      <p v-if="notice" class="m-0 mr-auto font-sans text-[12px] text-err-text" role="status" data-testid="skill-editor-notice">
        {{ t(`skillsView.edit.${notice}`) }}
        <button
          v-if="notice === 'changed'"
          type="button"
          class="ml-1 cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] text-accent hover:underline"
          @click="emit('reload')"
        >
          {{ t("skillsView.edit.reload") }}
        </button>
      </p>
      <button
        type="button"
        class="cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 font-sans text-[13px] text-secondary hover:text-fg"
        :disabled="saving"
        data-testid="skill-editor-cancel"
        @click="emit('cancel')"
      >
        {{ t("skillsView.edit.cancel") }} <kbd class="font-sans text-[11px] text-dim">Esc</kbd>
      </button>
      <button
        type="button"
        class="cursor-pointer rounded-[6px] border-0 bg-accent px-4 py-2 font-sans text-[13px] font-semibold text-on-accent disabled:opacity-60"
        :disabled="saving"
        data-testid="skill-editor-save"
        @click="save"
      >
        {{ t("skillsView.edit.save") }} <kbd class="font-sans text-[11px] opacity-80">⌘Enter</kbd>
      </button>
    </footer>
  </div>
</template>
