<script setup lang="ts">
// Every skill on disk, by where it lives (#2815): the user's `~/.claude/skills`, the enabled plugins,
// then the `.claude/skills` of each folder a terminal has run in. Three columns — where, which skill,
// its SKILL.md — because one plugin alone can bring a thousand skills, which no single list survives.
// The search narrows the first two columns together. A user or project skill can be edited in place. A second mode searches skills.sh for
// skills that are not on disk yet (SkillsShPane).
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import MarkdownProse from "./MarkdownProse.vue";
import FullScreenOverlay from "./FullScreenOverlay.vue";
import SkillsShPane from "./SkillsShPane.vue";
import SkillDocEditor from "./SkillDocEditor.vue";
import SkillEvalPanel from "./SkillEvalPanel.vue";
import { useSkillsView } from "../composables/useSkillsView";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import { loadSkillCatalog, loadSkillDoc, loadSkillUsage } from "../composables/useSkillCatalog";
import type { SkillUsage } from "../../common/skillUsage";
import { filterSkillCatalog, type CatalogSkill, type SkillCatalog, type SkillSource } from "../../common/skillCatalog";
import { stripFrontmatter } from "../wikiMarkdown";

const { t, locale } = useI18n();
const { isOpen, close } = useSkillsView();
useEscapeToClose(isOpen, close);

const catalog = shallowRef<SkillCatalog | null>(null);
/** null until read, and when the Library's index could not say: then no count is shown at all. */
const usage = shallowRef<ReadonlyMap<string, SkillUsage> | null>(null);
const loadFailed = ref(false);
const query = ref("");
const chosenSourceKey = ref<string | null>(null);
const picked = shallowRef<{ source: SkillSource; skill: CatalogSkill } | null>(null);
const doc = ref<string | null>(null);
/** The SKILL.md as read, and the version to save over when the user may edit it here. */
const raw = ref<string | null>(null);
const docVersion = ref<string | null>(null);
const editing = ref(false);
const docFailed = ref(false);
const mode = ref<"local" | "remote">("local");
const MODES = ["local", "remote"] as const;

// The names claude would resolve `/name` to here. A plugin's skills are namespaced, so they do not count.
const localSlugs = computed(
  () => new Set((catalog.value?.sources ?? []).filter((source) => source.scope !== "plugin").flatMap((source) => source.skills.map((skill) => skill.slug))),
);

const sourceKey = (source: SkillSource): string => `${source.scope}:${source.plugin}:${source.dir}`;
const shownSources = computed(() => (catalog.value ? filterSkillCatalog(catalog.value, query.value).sources : []));
// The chosen place while the search still matches something in it, else the first one that does —
// so typing a query never leaves the middle column showing a place with nothing in it.
const currentSource = computed(() => shownSources.value.find((source) => sourceKey(source) === chosenSourceKey.value) ?? shownSources.value[0] ?? null);
const isCurrent = (source: SkillSource): boolean => !!currentSource.value && sourceKey(currentSource.value) === sourceKey(source);
const isPicked = (source: SkillSource, skill: CatalogSkill): boolean =>
  !!picked.value && sourceKey(picked.value.source) === sourceKey(source) && picked.value.skill.id === skill.id;

const SOURCE_ICONS: Record<SkillSource["scope"], string> = { user: "home", plugin: "extension", project: "folder" };
function sourceLabel(source: SkillSource): string {
  if (source.scope === "user") return t("skillsView.user");
  return source.scope === "plugin" ? source.plugin : source.dir;
}

const usageOf = (skill: CatalogSkill): SkillUsage | null => usage.value?.get(skill.id) ?? null;
const usageDate = (at_ms: number): string => new Date(at_ms).toLocaleDateString(locale.value, { year: "numeric", month: "numeric", day: "numeric" });
function usageDetail(skill: CatalogSkill): string {
  const used = usageOf(skill);
  if (used === null) return t("skillsView.usage.detailNone");
  if (used.lastUsedAt === null) return t("skillsView.usage.detailNoDate", { count: used.conversations });
  return t("skillsView.usage.detail", { count: used.conversations, date: usageDate(used.lastUsedAt) });
}

// Apart from the catalog, so a slow index never holds the list back. Each opening counts as a new
// read: an answer for an earlier one that arrives late must not replace a newer one.
let usageRead = 0;
async function refreshUsage(): Promise<void> {
  const read = ++usageRead;
  const answer = await loadSkillUsage();
  if (read === usageRead) usage.value = answer;
}

async function refresh(): Promise<void> {
  catalog.value = null;
  usage.value = null;
  loadFailed.value = false;
  void refreshUsage();
  const read = await loadSkillCatalog();
  catalog.value = read;
  loadFailed.value = read === null;
}

watch(
  isOpen,
  (open) => {
    picked.value = null;
    doc.value = null;
    mode.value = "local";
    if (open) void refresh();
  },
  { immediate: true },
);

async function pick(source: SkillSource, skill: CatalogSkill): Promise<void> {
  picked.value = { source, skill };
  doc.value = null;
  raw.value = null;
  docVersion.value = null;
  editing.value = false;
  docFailed.value = false;
  const read = await loadSkillDoc(source, skill.slug);
  if (!isPicked(source, skill)) return; // moved on while the request was in flight
  showDoc(read?.markdown ?? null, read?.version ?? null);
  docFailed.value = read === null;
}

function showDoc(markdown: string | null, version: string | null): void {
  raw.value = markdown;
  doc.value = markdown === null ? null : stripFrontmatter(markdown);
  docVersion.value = version;
}

function onSaved(text: string, version: string): void {
  showDoc(text, version);
  editing.value = false;
}

async function reload(): Promise<void> {
  const current = picked.value;
  if (current !== null) await pick(current.source, current.skill);
}
</script>

<template>
  <FullScreenOverlay v-if="isOpen" :region-label="t('skillsView.region')" :close-label="t('skillsView.close')" @close="close">
    <template #header>
      <span class="font-sans text-[14px] font-[650] text-fg">{{ t("skillsView.title") }}</span>
      <div class="flex rounded-[4px] border border-border" role="group" :aria-label="t('skillsView.modes')">
        <button
          v-for="choice in MODES"
          :key="choice"
          type="button"
          :data-testid="`skills-mode-${choice}`"
          class="cursor-pointer border-none px-2 py-1 font-sans text-[12px] hover:bg-hover hover:text-fg"
          :class="mode === choice ? 'bg-hover text-fg' : 'bg-transparent text-secondary'"
          :aria-pressed="mode === choice"
          @click="mode = choice"
        >
          {{ t(`skillsView.mode.${choice}`) }}
        </button>
      </div>
      <input
        v-if="mode === 'local'"
        v-model="query"
        type="search"
        data-testid="skills-search"
        :placeholder="t('skillsView.search')"
        :aria-label="t('skillsView.search')"
        class="w-[320px] max-w-[50vw] rounded-[4px] border border-border bg-base px-2 py-1 font-sans text-[12px] text-fg"
      />
    </template>

    <SkillsShPane v-if="mode === 'remote'" :local-slugs="localSlugs" />
    <p v-else-if="loadFailed" class="m-0 p-4 font-sans text-[13px] text-err-text">{{ t("skillsView.loadFailed") }}</p>
    <p v-else-if="!catalog" class="m-0 p-4 font-sans text-[13px] text-dim">{{ t("skillsView.loading") }}</p>
    <p v-else-if="!catalog.sources.length" class="m-0 p-4 font-sans text-[13px] text-dim">{{ t("skillsView.empty") }}</p>
    <p v-else-if="!shownSources.length" class="m-0 p-4 font-sans text-[13px] text-dim">{{ t("skillsView.noMatch") }}</p>

    <div v-else class="flex min-h-0 flex-1">
      <nav class="w-[260px] flex-none overflow-y-auto border-r border-border bg-panel p-1" :aria-label="t('skillsView.sources')">
        <button
          v-for="source in shownSources"
          :key="sourceKey(source)"
          type="button"
          data-testid="skills-source"
          class="flex w-full cursor-pointer items-center gap-1.5 rounded-[4px] border-none px-2 py-1.5 text-left font-sans text-[12px] hover:bg-hover hover:text-fg"
          :class="isCurrent(source) ? 'bg-hover text-fg' : 'bg-transparent text-secondary'"
          :aria-current="isCurrent(source) ? 'true' : undefined"
          @click="chosenSourceKey = sourceKey(source)"
        >
          <span class="material-symbols-outlined flex-none text-[14px] text-dim" aria-hidden="true">{{ SOURCE_ICONS[source.scope] }}</span>
          <span class="min-w-0 flex-1 truncate" :data-tip="source.dir">{{ sourceLabel(source) }}</span>
          <span class="flex-none text-[11px] text-dim">{{ source.skills.length }}</span>
        </button>
      </nav>

      <nav v-if="currentSource" class="w-[340px] flex-none overflow-y-auto border-r border-border p-1" :aria-label="t('skillsView.title')">
        <button
          v-for="skill in currentSource.skills"
          :key="skill.id"
          type="button"
          data-testid="skills-item"
          class="block w-full cursor-pointer rounded-[4px] border-none px-2 py-1.5 text-left hover:bg-hover"
          :class="isPicked(currentSource, skill) ? 'bg-hover' : 'bg-transparent'"
          @click="pick(currentSource, skill)"
        >
          <span class="flex items-baseline gap-2">
            <span class="truncate font-mono text-[12px] text-fg">{{ skill.id }}</span>
            <span v-if="skill.overridesUser" data-testid="skills-overrides" class="flex-none font-sans text-[10px] text-warn">{{
              t("skillsView.overrides")
            }}</span>
            <span v-if="usage" data-testid="skills-usage" class="ml-auto flex-none font-sans text-[10px] text-dim">{{
              usageOf(skill) ? t("skillsView.usage.count", { count: usageOf(skill)?.conversations }) : t("skillsView.usage.none")
            }}</span>
          </span>
          <span class="line-clamp-2 font-sans text-[11px] leading-snug text-secondary">{{ skill.description }}</span>
        </button>
      </nav>

      <section class="min-w-0 flex-1 overflow-y-auto p-4">
        <p v-if="!picked" class="m-0 font-sans text-[13px] text-dim">{{ t("skillsView.pick") }}</p>
        <template v-else>
          <p class="m-0 mb-1 font-mono text-[14px] font-[650] text-fg">{{ picked.skill.id }}</p>
          <p class="m-0 mb-3 flex items-center gap-3 font-mono text-[11px] text-dim">
            <span class="min-w-0 truncate">{{ picked.source.dir }}</span>
            <button
              v-if="docVersion !== null && !editing"
              type="button"
              data-testid="skills-edit"
              class="ml-auto flex flex-none cursor-pointer items-center gap-1 rounded border border-border bg-transparent px-2 py-1 font-sans text-[12px] text-secondary hover:text-fg"
              @click="editing = true"
            >
              <span class="material-symbols-outlined text-[14px]">edit</span>{{ t("skillsView.edit.edit") }}
            </button>
          </p>
          <p v-if="usage" data-testid="skills-usage-detail" class="m-0 mb-3 font-sans text-[12px] text-secondary">{{ usageDetail(picked.skill) }}</p>
          <SkillEvalPanel v-if="!editing" :source="picked.source" :skill="picked.skill" />
          <p v-if="docFailed" data-testid="skills-doc-error" class="m-0 font-sans text-[13px] text-err-text">{{ t("skillsView.docFailed") }}</p>
          <SkillDocEditor
            v-else-if="editing && raw !== null && docVersion !== null"
            :key="picked.skill.id"
            :source="picked.source"
            :slug="picked.skill.slug"
            :text="raw"
            :version="docVersion"
            @saved="onSaved"
            @cancel="editing = false"
            @reload="reload"
          />
          <div v-else-if="doc !== null" class="max-w-[90ch] font-sans text-[13px] text-fg"><MarkdownProse :markdown="doc" images-as-links /></div>
        </template>
      </section>
    </div>
  </FullScreenOverlay>
</template>
