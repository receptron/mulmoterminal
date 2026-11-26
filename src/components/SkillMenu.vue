<script setup lang="ts">
import { ref, watch, useTemplateRef } from "vue";
import AnchoredMenu from "./AnchoredMenu.vue";
import { LIST_MENU_ITEM_CLASS, LIST_MENU_PANEL_CLASS } from "./anchoredMenuClasses";
import { isUnknownArray } from "../../common/isUnknownArray";
import { isDiscoveredSkill, type DiscoveredSkill } from "../composables/useDirLists";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { useI18n } from "vue-i18n";
import { dirApiUrl } from "../composables/dirAddress";

const { t } = useI18n();

// A header dropdown that lists the open project's discoverable skills (user +
// project `.claude/skills`) and emits the slug picked, so the parent can invoke it
// in the running session. Skills are fetched up front (and on cwd change) so the
// button only appears when there's something to run — no skills, no button.
// Mirrors RunMenu, but a skill runs in the agent (parent types its /<slug>), not a
// spare shell cell.
const props = defineProps<{ cwd: string | null }>();
const emit = defineEmits<{ (e: "skill", slug: string): void }>();

const skills = ref<DiscoveredSkill[]>([]);
let req = 0; // request token: drop out-of-order responses

// Teleported and pulled back inside the viewport, because this row sits at the cell's right edge
// often enough that a menu hanging rightwards from it was cut off by the cell.
const menu = useTemplateRef<InstanceType<typeof AnchoredMenu>>("menu");

async function loadSkills() {
  // Close first: a cwd change invalidates the open dropdown.
  menu.value?.close();
  const reqId = ++req;
  const dir = props.cwd;
  // No resolved project dir yet (e.g. a single-view reconnect before the session
  // message arrives): show nothing rather than fetching with an empty cwd, which the
  // server would resolve to the DEFAULT workspace — the wrong project's skills.
  if (!dir) {
    skills.value = [];
    return;
  }
  try {
    const res = await fetchWithTimeout(dirApiUrl(dir, "/api/skills"));
    const data = res.ok ? await jsonBody(res) : {};
    if (reqId !== req) return;
    skills.value = isUnknownArray(data.skills) ? data.skills.filter(isDiscoveredSkill) : [];
  } catch {
    if (reqId === req) skills.value = [];
  }
}
watch(() => props.cwd, loadSkills, { immediate: true });

function pick(s: DiscoveredSkill) {
  emit("skill", s.slug);
  menu.value?.leave();
}
</script>

<template>
  <AnchoredMenu
    v-if="skills.length"
    ref="menu"
    item-selector='[role="menuitem"]'
    initial-focus="first"
    :panel-class="LIST_MENU_PANEL_CLASS"
    testid="skill-menu"
  >
    <template #trigger="{ open, toggle }">
      <button
        class="inline-flex items-center gap-1 border border-border bg-base text-secondary font-sans text-[12px] leading-none py-[5px] px-2.5 rounded-md cursor-pointer hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg"
        :aria-expanded="open"
        aria-haspopup="menu"
        :data-tip="t('tips.overlays.runSkill')"
        @click="toggle"
      >
        <span class="material-symbols-outlined" aria-hidden="true">bolt</span> Skill
        <span class="material-symbols-outlined" aria-hidden="true">{{ open ? "expand_less" : "expand_more" }}</span>
      </button>
    </template>
    <button v-for="s in skills" :key="s.slug" :class="LIST_MENU_ITEM_CLASS" role="menuitem" :data-tip="s.description" @click="pick(s)">
      <span class="material-symbols-outlined flex-none" aria-hidden="true">bolt</span>
      <span class="truncate">{{ s.slug }}</span>
    </button>
  </AnchoredMenu>
</template>
