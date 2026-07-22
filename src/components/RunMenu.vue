<script setup lang="ts">
import { ref, watch, useTemplateRef } from "vue";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import type { RunCommand } from "./runCommand";

// A header dropdown that lists a directory's script.json entries and emits the one
// picked, so the parent can launch it. Scripts are fetched up front (and on cwd
// change) so the button only appears when the open project actually has scripts —
// no file, no button.
interface RunnableScript {
  index: number;
  label: string;
  command: string;
}
const props = defineProps<{ cwd: string | null }>();
const emit = defineEmits<{ (e: "run", command: RunCommand): void }>();

const scripts = ref<RunnableScript[]>([]);
// The resolved dir the listed scripts belong to (the server may fall back from a
// bad path); the picked command runs there.
const scriptsCwd = ref<string | null>(null);
let req = 0; // request token: drop out-of-order responses

const rootRef = useTemplateRef<HTMLElement>("root");
const { open, close, toggle } = useDropdownMenu(rootRef);

async function loadScripts() {
  // Close first: a cwd change invalidates the open dropdown (and would otherwise
  // leave the global listeners attached and the menu re-appearing pre-opened on a
  // later cwd, since the button can unmount while `open` stays true).
  close();
  const reqId = ++req;
  const dir = props.cwd;
  // No resolved project dir yet (e.g. a single-view reconnect before the session
  // message arrives): show nothing rather than fetching with an empty cwd, which the
  // server would resolve to the DEFAULT workspace — the wrong project's scripts.
  if (!dir) {
    scripts.value = [];
    scriptsCwd.value = null;
    return;
  }
  try {
    const res = await fetch(`/api/scripts?cwd=${encodeURIComponent(dir)}`);
    const data = res.ok ? await res.json() : { scripts: [], cwd: dir };
    if (reqId !== req) return;
    scripts.value = Array.isArray(data.scripts) ? data.scripts : [];
    scriptsCwd.value = data.cwd ?? dir;
  } catch {
    if (reqId === req) {
      scripts.value = [];
      scriptsCwd.value = null;
    }
  }
}
watch(() => props.cwd, loadScripts, { immediate: true });

function pick(s: RunnableScript) {
  emit("run", { source: "script", index: s.index, label: s.label, cwd: scriptsCwd.value ?? props.cwd });
  close();
}
</script>

<template>
  <div v-if="scripts.length" ref="root" class="relative inline-flex">
    <button
      class="border border-border bg-base text-secondary font-sans text-[12px] leading-none py-[5px] px-2.5 rounded-md cursor-pointer hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg"
      :aria-expanded="open"
      aria-haspopup="menu"
      title="Run a script in a spare terminal"
      @click="toggle"
    >
      ▶ Run ▾
    </button>
    <div
      v-if="open"
      class="absolute top-[calc(100%+4px)] left-0 z-20 min-w-[180px] max-h-80 overflow-y-auto flex flex-col p-1 bg-panel border border-border rounded-md shadow-[0_6px_20px_rgba(0,0,0,0.35)]"
      role="menu"
    >
      <button
        v-for="s in scripts"
        :key="s.index"
        class="text-left border-0 bg-transparent text-secondary font-mono text-[12px] py-1.5 px-2 rounded cursor-pointer whitespace-nowrap hover:bg-hover hover:text-fg"
        role="menuitem"
        :title="s.command"
        @click="pick(s)"
      >
        ▶ {{ s.label }}
      </button>
    </div>
  </div>
</template>
