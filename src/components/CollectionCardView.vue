<script setup lang="ts">
// MulmoTerminal wrapper around the collection plugin's chat View. It forwards the
// GUI-panel props to the package View unchanged, and — because the package's record
// modal teleports to the host-supplied `modalTeleportTarget` — registers THIS card's
// shadow root (resolved via getRootNode(), since PluginFrame mounts us inside one)
// as the active teleport target while mounted. Without this, the modal would
// teleport to <body>, escape the shadow root, and lose the injected plugin styles.
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import { plugin } from "@mulmoclaude/collection-plugin/vue";
import { pushCollectionTeleportTarget, popCollectionTeleportTarget } from "../composables/collectionUi";

defineProps<{
  selectedResult: ToolResult | null;
  sendTextMessage?: (text?: string) => void;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResult] }>();

const ChatView = plugin.viewComponent;

const rootEl = ref<HTMLElement>();
let registered: HTMLElement | ShadowRoot | null = null;

onMounted(() => {
  // Inside PluginFrame's shadow root, getRootNode() returns that ShadowRoot.
  const root = rootEl.value?.getRootNode();
  if (root instanceof ShadowRoot) {
    registered = root;
    pushCollectionTeleportTarget(root);
  }
});

onBeforeUnmount(() => {
  if (registered) {
    popCollectionTeleportTarget(registered);
    registered = null;
  }
});
</script>

<template>
  <!-- Fill the fixed-height frame (PluginFrame `height` → shadow mount 100%) so the
       package View's internal h-full layout — table/kanban scroll, custom-view
       iframe — resolves against a definite height. Inline style, not scoped CSS:
       this element lives inside the plugin's shadow root, which document-head
       <style> (where Vue puts scoped CSS) can't reach. -->
  <div ref="rootEl" :style="{ height: '100%' }">
    <component
      :is="ChatView"
      :selected-result="selectedResult"
      :send-text-message="sendTextMessage"
      @update-result="(result: ToolResult) => emit('updateResult', result)"
    />
  </div>
</template>
