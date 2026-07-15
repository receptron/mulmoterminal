<script setup lang="ts">
import { ref, onUnmounted, watch, useTemplateRef } from "vue";

// A header dropdown that lists the open project's discoverable skills (user +
// project `.claude/skills`) and emits the slug picked, so the parent can invoke it
// in the running session. Skills are fetched up front (and on cwd change) so the
// button only appears when there's something to run — no skills, no button.
// Mirrors RunMenu, but a skill runs in the agent (parent types its /<slug>), not a
// spare shell cell.
interface DiscoveredSkill {
  slug: string;
  description: string;
}
const props = defineProps<{ cwd: string | null }>();
const emit = defineEmits<{ (e: "skill", slug: string): void }>();

const open = ref(false);
const skills = ref<DiscoveredSkill[]>([]);
let req = 0; // request token: drop out-of-order responses

const rootRef = useTemplateRef<HTMLElement>("root");

async function loadSkills() {
  // Close first: a cwd change invalidates the open dropdown (and would otherwise
  // leave the global listeners attached and the menu re-appearing pre-opened on a
  // later cwd, since the button can unmount while `open` stays true).
  close();
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
    const res = await fetch(`/api/skills?cwd=${encodeURIComponent(dir)}`);
    const data = res.ok ? await res.json() : { skills: [] };
    if (reqId !== req) return;
    skills.value = Array.isArray(data.skills) ? data.skills : [];
  } catch {
    if (reqId === req) skills.value = [];
  }
}
watch(() => props.cwd, loadSkills, { immediate: true });

function onOutside(e: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) close();
}
function onEscape(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

function openMenu() {
  open.value = true;
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onEscape);
}
function close() {
  open.value = false;
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onEscape);
}
function toggle() {
  if (open.value) close();
  else openMenu();
}

function pick(s: DiscoveredSkill) {
  emit("skill", s.slug);
  close();
}

onUnmounted(close);
</script>

<template>
  <div v-if="skills.length" ref="root" class="skill-menu">
    <button
      class="skill-trigger"
      :class="{ active: open }"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="Run a skill in the current session"
      @click="toggle"
    >
      ⚡ Skill ▾
    </button>
    <div v-if="open" class="skill-pop" role="menu">
      <button v-for="s in skills" :key="s.slug" class="skill-item" role="menuitem" :title="s.description" @click="pick(s)">⚡ {{ s.slug }}</button>
    </div>
  </div>
</template>

<style scoped>
.skill-menu {
  position: relative;
  display: inline-flex;
}

/* Matches the grid toolbar buttons (.tb-btn lives in GridView's scoped styles). */
.skill-trigger {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-family: system-ui, sans-serif;
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.skill-trigger:hover,
.skill-trigger.active {
  background: var(--bg-hover);
  color: var(--text);
}

.skill-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  min-width: 180px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.skill-item {
  text-align: left;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.skill-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
