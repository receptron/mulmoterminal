<script setup lang="ts">
import { ref, watch, useTemplateRef } from "vue";
import { useDropdownMenu } from "../composables/useDropdownMenu";

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

const skills = ref<DiscoveredSkill[]>([]);
let req = 0; // request token: drop out-of-order responses

const rootRef = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(rootRef);

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

function pick(s: DiscoveredSkill) {
  emit("skill", s.slug);
  close();
}
</script>

<template>
  <div v-if="skills.length" ref="root" class="relative inline-flex">
    <button
      class="border border-border bg-base text-secondary font-sans text-[12px] leading-none py-[5px] px-2.5 rounded-md cursor-pointer hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="Run a skill in the current session"
      @click="toggle"
    >
      ⚡ Skill ▾
    </button>
    <div
      v-if="open"
      class="absolute top-[calc(100%+4px)] left-0 z-20 min-w-[180px] max-h-80 overflow-y-auto flex flex-col p-1 bg-panel border border-border rounded-md shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
      role="menu"
    >
      <button
        v-for="s in skills"
        :key="s.slug"
        class="text-left border-0 bg-transparent text-secondary font-mono text-[12px] py-1.5 px-2 rounded cursor-pointer whitespace-nowrap hover:bg-hover hover:text-fg"
        role="menuitem"
        :title="s.description"
        @click="pick(s)"
      >
        ⚡ {{ s.slug }}
      </button>
    </div>
  </div>
</template>
