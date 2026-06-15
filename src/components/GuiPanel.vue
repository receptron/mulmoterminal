<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { usePubSub } from "../composables/usePubSub";

// The GUI panel renders the structured `data` pushed by GUI-protocol MCP tools
// (Phase I: presentMarkdown). It mirrors the terminal's active session: live
// frames arrive on the "gui" pub/sub channel, and history is replayed from
// /api/gui/:sessionId when a session is (re)selected. See the spike doc.
const props = defineProps<{ sessionId: string | null }>();

interface GuiFrame {
  type: string;
  data: { markdown?: string };
}

const frames = ref<GuiFrame[]>([]);

// Render markdown -> sanitized HTML. marked handles GFM tables; DOMPurify strips
// anything unsafe before it reaches v-html.
function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

const renderedFrames = computed(() =>
  frames.value.map((f) => renderMarkdown(f.data.markdown ?? ""))
);

async function loadHistory(id: string) {
  try {
    const res = await fetch(`/api/gui/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    frames.value = data.payloads ?? [];
  } catch {
    frames.value = [];
  }
}

// Reload history whenever the active session changes (and clear for a fresh,
// not-yet-identified session).
watch(
  () => props.sessionId,
  (id) => {
    if (id) loadHistory(id);
    else frames.value = [];
  },
  { immediate: true }
);

const GUI_CHANNEL_NAME = "gui";
const { subscribe } = usePubSub();
let unsubscribe: (() => void) | undefined;

onMounted(() => {
  unsubscribe = subscribe(GUI_CHANNEL_NAME, (data) => {
    const msg = data as { sessionId: string } & GuiFrame;
    // Only render frames for the session currently in the foreground.
    if (msg.sessionId !== props.sessionId) return;
    frames.value = [...frames.value, { type: msg.type, data: msg.data }];
  });
});
onUnmounted(() => unsubscribe?.());

const hasContent = computed(() => frames.value.length > 0);
</script>

<template>
  <section class="gui-panel">
    <div class="header">
      <span class="title">GUI</span>
    </div>
    <div class="content">
      <div v-if="!hasContent" class="empty">
        Ask Claude to use <code>presentMarkdown</code> to render content here.
      </div>
      <!-- DOMPurify-sanitized above; v-html is required to render markdown. -->
      <!-- eslint-disable vue/no-v-html -->
      <article
        v-for="(html, i) in renderedFrames"
        :key="i"
        class="frame markdown-body"
        v-html="html"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
  </section>
</template>

<style scoped>
.gui-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100vh;
  background: #11162a;
  border-left: 1px solid #2a2a4e;
}

.header {
  padding: 8px 16px;
  background: #16213e;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 14px;
}
.title {
  font-weight: 600;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.empty {
  color: #7c87a8;
  font-size: 13px;
}
.empty code {
  background: #1d2b4e;
  padding: 1px 5px;
  border-radius: 4px;
}

.frame + .frame {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #2a2a4e;
}
</style>

<!-- Markdown element styling (unscoped: targets v-html output). -->
<style>
.markdown-body table {
  border-collapse: collapse;
  margin: 8px 0;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid #2a2a4e;
  padding: 4px 10px;
  text-align: left;
}
.markdown-body th {
  background: #1d2b4e;
}
.markdown-body code {
  background: #1d2b4e;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.9em;
}
.markdown-body pre {
  background: #0d1124;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
}
.markdown-body pre code {
  background: none;
  padding: 0;
}
.markdown-body a {
  color: #4a8cff;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin: 12px 0 6px;
}
</style>
