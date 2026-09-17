<script setup lang="ts">
// Open a file by typing part of its name, instead of walking the tree one directory at a time
// (#2099). Mounted by FilesPane, over the pane it belongs to, and it owns the whole interaction:
// the candidate list, the filtering, the keyboard, and picking.
//
// It fetches the candidates ITSELF, once per opening, rather than being handed them. Two reasons:
// the pane already carries enough, and the list must be FRESH — the agent running in this very
// directory creates files while the user watches, so a list cached between openings would be
// missing exactly the file they just saw scroll past.
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { finderRow, rankPaths } from "./filePathMatch";
import { menuFocusMove } from "./filesRowActions";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

/** How many rows are ranked into view. More than fills the panel: the list scrolls, and a reader
 *  who has typed two characters is still scanning rather than reading. */
const MAX_RESULTS = 50;

/** The keys that move the selection. See `onKeydown` for why the list is this short. */
const LIST_KEYS = ["ArrowUp", "ArrowDown"];

const props = defineProps<{ cwd: string | null }>();
const emit = defineEmits<{ pick: [pathRel: string]; close: [] }>();

const query = ref("");
const paths = ref<string[]>([]);
const truncated = ref(false);
const ignoresGitignore = ref(false);
const loading = ref(true);
const loadError = ref<string | null>(null);
const active = ref(0);

// The index request outlives the panel otherwise: its deadline is the SLOW one, so a finder closed
// a second after it opened would keep a request alive for up to a minute and then write into refs
// nobody is rendering (Codex on #2102). `fetchWithTimeout` keeps a caller's signal and composes it
// with its own, which is the seam this uses.
const abort = new AbortController();

const input = useTemplateRef<HTMLInputElement>("input");
const listEl = useTemplateRef<HTMLElement>("listEl");
const panel = useTemplateRef<HTMLElement>("panel");

const rows = computed(() => rankPaths(paths.value, query.value, MAX_RESULTS).map((match) => ({ path: match.path, ...finderRow(match.path, match.indexes) })));

// Typing changes what is under the cursor, so the selection goes back to the top rather than
// staying on whatever row happens to be in that position now — and the list is scrolled back with
// it, or a narrowed list would open part-way down with its first row out of sight.
watch(query, () => {
  active.value = 0;
  if (listEl.value) listEl.value.scrollTop = 0;
});

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const params = new URLSearchParams(props.cwd ? { cwd: props.cwd } : {});
    // NOT the default 8s deadline: this route shells out to `git ls-files`, whose own cap on the
    // server is 10s, and a repository that misses it is then WALKED. With the default the browser
    // would give up first — every time — and a slow project would report a timeout for a request
    // that was about to succeed.
    const res = await fetchWithTimeout(`/api/files/browse/index?${params.toString()}`, { signal: abort.signal }, SLOW_COMMAND_TIMEOUT_MS);
    const data = await jsonBody(res);
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
    // Checked off the wire: the list is rendered and then OPENED, so a malformed entry would
    // become a row that silently opens nothing.
    if (!isUnknownArray(data.paths)) throw new Error("GET /api/files/browse/index → body has no paths array");
    paths.value = data.paths.filter((entry): entry is string => typeof entry === "string");
    truncated.value = data.truncated === true;
    // `walk` is the answer for a directory that is not a repository, and there `.gitignore` is
    // nobody's rule — saying so beats letting the user conclude their ignore file is broken.
    ignoresGitignore.value = data.source === "walk";
  } catch (e) {
    // An abort is this panel closing, not a failure to report to a reader who is no longer there.
    if (abort.signal.aborted) return;
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function pick(index: number): void {
  const chosen = rows.value[index];
  if (chosen) emit("pick", chosen.path);
}

/** Keep the selected row on screen. `nearest` rather than `center`: the list is short and a
 *  centring scroll on every arrow press makes the whole panel appear to move under the reader. */
watch(active, (index) => {
  listEl.value?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
});

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return; // an IME candidate list owns the arrows and Enter while composing
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    pick(active.value);
    return;
  }
  // The ARROWS only. `menuFocusMove` also answers Home and End, and in a row menu that is right —
  // here the keyboard is in a text field, where both belong to the caret the user is editing with.
  if (!LIST_KEYS.includes(event.key)) return;
  const to = menuFocusMove(event.key, active.value, rows.value.length);
  if (to === null) return;
  event.preventDefault();
  active.value = to;
}

// Clicking anywhere else is "not this after all". Pointerdown rather than click, so the pane
// underneath does not also act on the same gesture.
function onOutside(event: PointerEvent): void {
  const target = event.target instanceof Node ? event.target : null;
  if (!panel.value?.contains(target)) emit("close");
}

onMounted(() => {
  void load();
  input.value?.focus();
  window.addEventListener("pointerdown", onOutside);
});
onBeforeUnmount(() => {
  abort.abort();
  window.removeEventListener("pointerdown", onOutside);
});
</script>

<template>
  <div
    ref="panel"
    data-testid="file-finder"
    class="absolute left-1/2 top-2 z-40 w-[min(560px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
    role="dialog"
    aria-label="Open a file by name"
    @keydown="onKeydown"
  >
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <span class="material-symbols-outlined flex-none text-[18px] text-dim" aria-hidden="true">search</span>
      <input
        ref="input"
        v-model="query"
        data-testid="file-finder-input"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="file-finder-list"
        aria-autocomplete="list"
        :aria-activedescendant="rows.length > 0 ? `file-finder-row-${active}` : undefined"
        placeholder="Open a file by name"
        class="min-w-0 flex-auto border-0 bg-transparent font-mono text-[13px] text-fg outline-none placeholder:text-dim"
      />
      <button
        type="button"
        class="h-[22px] flex-none cursor-pointer rounded border-0 bg-transparent px-1 text-dim hover:text-fg"
        title="Close"
        aria-label="Close the file finder"
        @click="emit('close')"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
      </button>
    </div>
    <p v-if="loadError" role="alert" data-testid="file-finder-error" class="px-3 py-2 text-[12px] text-err">{{ loadError }}</p>
    <p v-else-if="loading" class="px-3 py-2 text-[12px] text-muted">Reading the project…</p>
    <p v-else-if="rows.length === 0" data-testid="file-finder-empty" class="px-3 py-2 text-[12px] text-muted">No file matches that.</p>
    <ul v-show="!loading && !loadError && rows.length > 0" id="file-finder-list" ref="listEl" role="listbox" class="max-h-[320px] overflow-auto py-1">
      <li
        v-for="(row, index) in rows"
        :id="`file-finder-row-${index}`"
        :key="row.path"
        :data-index="index"
        data-testid="file-finder-row"
        role="option"
        :aria-selected="index === active"
        class="flex cursor-pointer items-baseline gap-2 whitespace-nowrap px-3 py-[3px] font-mono text-[12px]"
        :class="index === active ? 'bg-hover text-fg' : 'text-secondary'"
        @pointerenter="active = index"
        @click="pick(index)"
      >
        <span class="flex-none">
          <span v-for="(part, at) in row.name" :key="at" :class="part.hit ? 'font-bold text-accent' : ''">{{ part.text }}</span>
        </span>
        <span class="min-w-0 truncate text-[11px] text-dim">
          <span v-for="(part, at) in row.dir" :key="at" :class="part.hit ? 'font-bold text-accent' : ''">{{ part.text }}</span>
        </span>
      </li>
    </ul>
    <!-- Both notes are about what is NOT in the list. Silence here reads as "there is no such
         file", which is the one wrong answer a finder can give.
         "may not be listing", not "has more files": the flag means the server could not establish
         that it saw everything, which is not the same as knowing something is missing — a walk
         that stops at a directory cannot tell an empty one from an omitted one without reading it,
         and reading it is the cost the budget exists to avoid (Codex on #2102). -->
    <p v-if="truncated" data-testid="file-finder-truncated" class="border-t border-border px-3 py-1.5 text-[11px] text-muted">
      The finder may not be listing every file here — narrow the name if what you want is missing.
    </p>
    <p v-if="ignoresGitignore" data-testid="file-finder-unignored" class="border-t border-border px-3 py-1.5 text-[11px] text-muted">
      Not a git repository, so .gitignore is not applied — only node_modules and a few other caches are skipped.
    </p>
  </div>
</template>
