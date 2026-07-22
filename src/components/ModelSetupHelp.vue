<script setup lang="ts">
// What to configure, and where, to run a session on something other than the Anthropic
// subscription (#584).
//
// Deliberately narrow: when a provider is already configured but unusable, the server
// already knows exactly what is missing — that sentence goes at the top, and the full
// walkthrough moves below it. Setup instructions that bury the one broken line are how a
// user ends up re-doing the parts that already worked.
import { computed, onMounted, onUnmounted, nextTick, ref } from "vue";
import { trapTabKey } from "../utils/focusTrap";
import type { LaunchProviderOption } from "../composables/useLaunchOptions";

const props = defineProps<{ providers: LaunchProviderOption[] }>();
const emit = defineEmits<{ (e: "close"): void }>();

const blocked = computed(() => props.providers.filter((provider) => !provider.ready));

const CONFIG_EXAMPLE = `{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000
    }
  ]
}`;

const DIR_EXAMPLE = `{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}`;

const copy = (text: string) => navigator.clipboard?.writeText(text);

const modalEl = ref<HTMLElement>();

// Same modal keyboard contract as the settings dialog: Escape closes, Tab stays inside.
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") return emit("close");
  if (e.key !== "Tab" || !modalEl.value) return;
  trapTabKey(e, modalEl.value, 'button, input, [tabindex]:not([tabindex="-1"])');
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  nextTick(() => modalEl.value?.querySelector<HTMLElement>("button")?.focus());
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(0,0,0,0.55)] p-4" @click.self="emit('close')">
    <div
      ref="modalEl"
      class="flex max-h-full w-full max-w-[560px] flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-panel p-5 text-left"
      role="dialog"
      aria-modal="true"
      aria-label="Running a session on another model"
    >
      <div class="flex items-start justify-between gap-3">
        <h2 class="m-0 font-sans text-[15px] font-semibold text-fg">Running a session on another model</h2>
        <button type="button" class="cursor-pointer border-none bg-transparent p-0 text-dim hover:text-fg" aria-label="Close" @click="emit('close')">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <p class="m-0 font-sans text-[12px] leading-relaxed text-secondary">
        Claude Code can talk to any Anthropic-compatible backend. MulmoTerminal reads the backends from its own config, and their keys from the environment the
        <em>server</em> was started with — never from a file it serves.
      </p>

      <!-- The one sentence that matters when something is already configured but unusable. -->
      <section v-if="blocked.length" class="flex flex-col gap-1.5 rounded-md border border-border bg-elevated p-3">
        <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">Needs attention</span>
        <p v-for="provider in blocked" :key="provider.id" class="m-0 font-mono text-[11px] leading-relaxed text-fg">{{ provider.reason }}</p>
      </section>

      <section class="flex flex-col gap-1.5">
        <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">1 — Add the backend to ~/.mulmoterminal/config.json</span>
        <pre class="m-0 overflow-x-auto rounded-md border border-border bg-input p-3 font-mono text-[11px] leading-relaxed text-fg">{{ CONFIG_EXAMPLE }}</pre>
        <button
          type="button"
          class="self-start cursor-pointer border-none bg-transparent p-0 font-sans text-[11px] text-dim underline hover:text-fg"
          @click="copy(CONFIG_EXAMPLE)"
        >
          Copy
        </button>
        <p class="m-0 font-sans text-[11px] leading-relaxed text-secondary">
          <code class="font-mono">baseUrl</code> must not end in <code class="font-mono">/v1</code> — Claude Code appends
          <code class="font-mono">/v1/messages</code> itself. <code class="font-mono">tokenEnv</code> is the <em>name</em> of the variable holding the key.
        </p>
      </section>

      <section class="flex flex-col gap-1.5">
        <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">2 — Put the key in the server's environment</span>
        <pre class="m-0 overflow-x-auto rounded-md border border-border bg-input p-3 font-mono text-[11px] leading-relaxed text-fg">
OPENROUTER_API_KEY=sk-or-…</pre>
        <p class="m-0 font-sans text-[11px] leading-relaxed text-secondary">
          In the shell that starts MulmoTerminal, or a <code class="font-mono">.env</code> beside it. Keys never go in
          <code class="font-mono">config.json</code>. Restart the server after adding one.
        </p>
      </section>

      <section class="flex flex-col gap-1.5">
        <span class="font-sans text-[11px] uppercase tracking-[0.05em] text-dim">3 — Optional: a default for one project</span>
        <pre class="m-0 overflow-x-auto rounded-md border border-border bg-input p-3 font-mono text-[11px] leading-relaxed text-fg">{{ DIR_EXAMPLE }}</pre>
        <button
          type="button"
          class="self-start cursor-pointer border-none bg-transparent p-0 font-sans text-[11px] text-dim underline hover:text-fg"
          @click="copy(DIR_EXAMPLE)"
        >
          Copy
        </button>
        <p class="m-0 font-sans text-[11px] leading-relaxed text-secondary">
          In that project's <code class="font-mono">.mulmoterminal.json</code>. Every session there starts on it, and the picker above overrides it for one
          session.
        </p>
      </section>

      <p class="m-0 font-sans text-[11px] leading-relaxed text-secondary">
        Rather not edit JSON? Ask a Claude session in any directory: <em>“set up OpenRouter in my mulmoterminal config”</em> — the bundled
        <code class="font-mono">mulmoterminal-config</code> skill knows this file and the tested model list.
      </p>

      <p class="m-0 font-sans text-[11px] leading-relaxed text-dim">
        The pass rate beside each model — <code class="font-mono">3/3</code>, <code class="font-mono">2/3</code> — is how many attempts of a real
        read-a-file-write-a-file task it completed when it was measured. Models that answer fluently but never call a tool are the reason it is there.
      </p>
    </div>
  </div>
</template>
