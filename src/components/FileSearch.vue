<script setup lang="ts">
// Search the CONTENTS of the open directory (#2140) — the companion to FileFinder, which searches
// their names, and deliberately a SEPARATE component rather than a mode of it.
//
// They share a purpose and almost no mechanism. The finder fetches every path ONCE and filters in
// the browser on each keystroke; there is no version of this where the browser holds every file's
// text, so a search here is one server request per query, debounced, with the previous one aborted.
// The rows differ too: a file heading with its matching lines under it, not one row per path.
//
// The one file the disk cannot answer for is the one open in the editor with unsaved edits. Its
// disk matches are DISCARDED rather than merged in both modes — the two describe different
// documents, and a stale line number sends the jump to the wrong place. In literal mode the buffer
// is then searched here from its text; in regex mode it is not searched at all, because that means
// running an untrusted pattern on the thread that draws the UI, and the panel says so
// (common/fileSearch.ts carries the measurement).
//
// What a row SHOWS is decided in `searchResultView.ts` rather than here (#2159): where the query
// matched, whether the line has to be scrolled for the match to be on screen, and what the whole
// list adds up to. The lines AROUND the selected match come from `useSearchContext`.
import { computed, onBeforeUnmount, onMounted, ref, toRef, useTemplateRef, watch } from "vue";
import { groupByFile, isSearchable, withBufferMatches, type SearchMatch, type SearchRequest } from "../../common/fileSearch";
import { resultSummary, snippetView, splitAround, type SnippetView } from "./searchResultView";
import { useSearchContext, type SelectedResult } from "../composables/useSearchContext";
import { usePickerPanelKeys } from "../composables/usePickerPanelKeys";
import SearchContextLines from "./SearchContextLines.vue";
import { isUnknownArray } from "../../common/isUnknownArray";
import { isRecord } from "../../common/isRecord";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { browseUrl } from "./filesPaneApi";
import { useI18n } from "vue-i18n";
import type { FilesPanelSeed } from "../composables/filesPanelSeed";

const { t } = useI18n();

/** How long the panel waits after the last keystroke. Each query is a subprocess on the server, so
 *  this is not only about the network — typing "session" unthrottled would start seven greps. */
const DEBOUNCE_MS = 180;

const props = defineProps<{
  cwd: string | null;
  /** The remote host the root is on; absent or null for this machine. */
  host?: string | null;
  /** The file open in the editor and its CURRENT text, when it has unsaved edits. Null when nothing
   *  is dirty — then the disk answer is complete on its own. */
  buffer: { path: string; text: string } | null;
  seed?: FilesPanelSeed | undefined;
}>();
const emit = defineEmits<{ pick: [pathRel: string, line: number]; close: [] }>();

const query = ref("");
const regex = ref(false);
const caseSensitive = ref(false);
const matches = ref<SearchMatch[]>([]);
const truncated = ref(false);
const ignoresGitignore = ref(false);
const searching = ref(false);
const searchError = ref<string | null>(null);
const active = ref(0);

const input = useTemplateRef<HTMLInputElement>("input");
const listEl = useTemplateRef<HTMLElement>("listEl");
const panel = useTemplateRef<HTMLElement>("panel");

const request = computed((): SearchRequest => ({ query: query.value, regex: regex.value, ...(caseSensitive.value ? { caseSensitive: true } : {}) }));

// The buffer is applied HERE rather than on the server, so it re-applies when the user edits while
// the panel is open without costing another search.
const resolved = computed(() => withBufferMatches(matches.value, props.buffer, request.value));

/** One result, with everything the row needs already worked out. Built once per result set rather
 *  than per render: `snippetView` scans the line, and the panel re-renders on every arrow key. */
interface ResultRow {
  match: SearchMatch;
  view: SnippetView;
  /** Position in the flat list the arrows walk. */
  index: number;
}

const groups = computed((): { path: string; rows: ResultRow[] }[] => {
  const grouped = groupByFile(resolved.value.matches);
  const flat = grouped.flatMap((group) => group.matches);
  return grouped.map((group) => ({
    path: group.path,
    rows: group.matches.map((match) => ({ match, view: snippetView(match.text, request.value), index: flat.indexOf(match) })),
  }));
});

/** Every match as one flat list, in the order the groups render them — what the arrows walk. The
 *  headings are not selectable: they are not somewhere to jump to. */
const rows = computed(() => groups.value.flatMap((group) => group.rows));

const selected = computed((): SelectedResult | null => {
  const row = rows.value[active.value];
  return row ? { path: row.match.path, line: row.match.line } : null;
});

const context = useSearchContext({ cwd: toRef(props, "cwd"), host: () => props.host ?? null, buffer: toRef(props, "buffer"), selected });

/** The lines around the selected match, split so the row can keep drawing the matched line itself.
 *  Null until the read lands, which is why the block appears a moment after the selection moves. */
const activeContext = computed(() => {
  const row = rows.value[active.value];
  const around = context.surrounding.value;
  return row && around ? splitAround(around, row.match.line) : null;
});

// Only the newest answer may be applied: searches overlap, and an older one describes a query the
// user has already moved past. The same guard the roster's seed carries (#620).
let latest = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: AbortController | null = null;

async function runSearch(): Promise<void> {
  const seed = ++latest;
  // BEFORE the empty-query exit, not after it. Clearing the box is the most likely moment for a
  // search to still be running, and returning first left that one going — the one case where the
  // user has said most plainly that they no longer want it.
  inFlight?.abort();
  if (!isSearchable(query.value)) {
    matches.value = [];
    truncated.value = false;
    searchError.value = null;
    searching.value = false;
    return;
  }
  const abort = new AbortController();
  inFlight = abort;
  searching.value = true;
  searchError.value = null;
  try {
    const params = new URLSearchParams({ q: query.value });
    if (props.cwd) params.set("cwd", props.cwd);
    if (regex.value) params.set("regex", "1");
    if (caseSensitive.value) params.set("case", "1");
    // NOT the default deadline: the route shells out to `git grep`, whose own cap on the server is
    // 10s. With the default the browser would give up first on a large repository, every time.
    const res = await fetchWithTimeout(browseUrl(props.host ?? null, "search", params.toString()), { signal: abort.signal }, SLOW_COMMAND_TIMEOUT_MS);
    const data = await jsonBody(res);
    if (seed !== latest) return;
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
    // Checked off the wire: a row is rendered and then OPENED, so a malformed entry would become a
    // row that jumps nowhere.
    matches.value = isUnknownArray(data.matches) ? data.matches.filter(isSearchMatch) : [];
    truncated.value = data.truncated === true;
    // Outside a repository there is no ignore file to apply. Saying so beats letting a reader
    // conclude their .gitignore is broken when node_modules appears.
    ignoresGitignore.value = data.source === "no-index";
  } catch (e) {
    if (abort.signal.aborted || seed !== latest) return; // superseded, not a failure to report
    searchError.value = e instanceof Error ? e.message : String(e);
    // The previous query's rows go with it. The list is only hidden by being EMPTY, so leaving them
    // put the error message above a set of rows that are still selectable — Enter or a click would
    // open a result belonging to a query that has already failed, which reads as the search having
    // worked. An error and an answer must not be on screen together.
    matches.value = [];
    truncated.value = false;
    ignoresGitignore.value = false;
  } finally {
    if (seed === latest) searching.value = false;
  }
}

const isSearchMatch = (value: unknown): value is SearchMatch =>
  isRecord(value) && typeof value.path === "string" && typeof value.line === "number" && typeof value.text === "string";

// The DIRECTORY, the query and both modes decide the answer together. A mode toggled after typing
// has to re-ask or the panel shows a literal search under a regex badge — and `cwd` is an input
// exactly like them, which it did not use to be: the pane deliberately survives a re-root, so a
// panel left open went on showing the previous project's matches until something else was typed.
//
// The rows are dropped SYNCHRONOUSLY on a directory change rather than waiting for the debounce,
// because during that window they are not merely out of date — they belong to another project, and
// picking one reveals its relative path under the new root.
watch(
  () => props.cwd,
  () => {
    matches.value = [];
    truncated.value = false;
    ignoresGitignore.value = false;
    searchError.value = null;
  },
);

watch([query, regex, caseSensitive, () => props.cwd], () => {
  if (timer) clearTimeout(timer);
  // The running search answers what was asked before this change: it must not land during the
  // debounce, under text it does not match.
  latest++;
  inFlight?.abort();
  timer = setTimeout(() => void runSearch(), DEBOUNCE_MS);
});

// The palette's `#` text, also when the panel is already open. After the watch above, so a text
// arriving with the mount runs the search.
watch(
  () => props.seed,
  (seed) => {
    if (seed) query.value = seed.text;
  },
  { immediate: true },
);

// Typing changes what is under the cursor, so the selection returns to the top and the list scrolls
// back with it — a narrowed list would otherwise open part-way down with its first row out of sight.
watch(rows, () => {
  if (active.value >= rows.value.length) active.value = 0;
});
watch(query, () => {
  active.value = 0;
  if (listEl.value) listEl.value.scrollTop = 0;
});

function pick(index: number): void {
  const chosen = rows.value[index];
  if (chosen) emit("pick", chosen.match.path, chosen.match.line);
}

/** Keep the selected row on screen. `nearest` rather than `center`, so the panel does not appear to
 *  move under the reader on every arrow press. */
const keepActiveVisible = (): void => {
  listEl.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: "nearest" });
};

// `post` on BOTH, and it is what makes them work at all. A selected row is several lines tall and
// every other row is one, so moving the selection changes the height of two rows — and a default
// `pre` watcher runs BEFORE that re-render, measuring the layout the row is leaving rather than the
// one it is arriving at. Measured: at `pre`, the arrival scroll saw no context block in the
// document and the arrow scroll still saw the previous row's (Codex, round 1; the arrow site is the
// same mistake one file over, which the finding did not name).
watch(active, keepActiveVisible, { flush: "post" });
watch(activeContext, keepActiveVisible, { flush: "post" });

const { onKeydown, onOutside } = usePickerPanelKeys({ panel, active, rowCount: () => rows.value.length, pick, close: () => emit("close") });

const isBufferPath = (path: string): boolean => props.buffer?.path === path;

onMounted(() => {
  input.value?.focus();
  window.addEventListener("pointerdown", onOutside);
});
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  inFlight?.abort();
  context.stop();
  window.removeEventListener("pointerdown", onOutside);
});
</script>

<template>
  <div
    ref="panel"
    data-testid="file-search"
    class="absolute left-1/2 top-2 z-40 w-[min(620px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
    role="dialog"
    :aria-label="t('tips.panes.searchInFiles')"
    @keydown="onKeydown"
  >
    <div class="flex items-center gap-2 border-b border-border px-3 py-2">
      <span class="material-symbols-outlined flex-none text-[18px] text-dim" aria-hidden="true">search</span>
      <input
        ref="input"
        v-model="query"
        data-testid="file-search-input"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="file-search-list"
        aria-autocomplete="list"
        :aria-activedescendant="rows.length > 0 ? `file-search-row-${active}` : undefined"
        placeholder="Search in files"
        class="min-w-0 flex-auto border-0 bg-transparent font-mono text-[13px] text-fg outline-none placeholder:text-dim"
      />
      <!-- Both modes are shown as their own state rather than hidden in a menu: a search that
           silently means something other than what was typed is the thing to avoid. -->
      <button
        type="button"
        data-testid="file-search-case"
        class="h-[22px] flex-none cursor-pointer rounded border px-1.5 font-mono text-[11px]"
        :class="caseSensitive ? 'border-accent bg-hover text-accent' : 'border-border bg-transparent text-dim hover:text-fg'"
        :aria-pressed="caseSensitive"
        :aria-label="t('tips.panes.matchCase')"
        :data-tip="t('tips.panes.matchCaseTip')"
        @click="caseSensitive = !caseSensitive"
      >
        Aa
      </button>
      <button
        type="button"
        data-testid="file-search-regex"
        class="h-[22px] flex-none cursor-pointer rounded border px-1.5 font-mono text-[11px]"
        :class="regex ? 'border-accent bg-hover text-accent' : 'border-border bg-transparent text-dim hover:text-fg'"
        :aria-pressed="regex"
        :aria-label="t('tips.panes.regex')"
        :data-tip="t('tips.panes.regex')"
        @click="regex = !regex"
      >
        .*
      </button>
      <button
        type="button"
        class="h-[22px] flex-none cursor-pointer rounded border-0 bg-transparent px-1 text-dim hover:text-fg"
        :data-tip="t('tips.panes.close')"
        :aria-label="t('tips.panes.closeSearch')"
        @click="emit('close')"
      >
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
      </button>
    </div>

    <p v-if="searchError" role="alert" data-testid="file-search-error" class="px-3 py-2 text-[12px] text-err">{{ searchError }}</p>
    <p v-else-if="!isSearchable(query)" class="px-3 py-2 text-[12px] text-muted">Type to search the contents of this directory.</p>
    <p v-else-if="searching && rows.length === 0" class="px-3 py-2 text-[12px] text-muted">Searching…</p>
    <p v-else-if="rows.length === 0" data-testid="file-search-empty" class="px-3 py-2 text-[12px] text-muted">Nothing in this directory matches that.</p>

    <!-- What the list adds up to, which cannot be had by scrolling it: a reader otherwise cannot
         tell eight files from eighty without reaching the bottom. -->
    <p v-if="rows.length > 0" data-testid="file-search-summary" class="border-b border-border px-3 py-1 text-[11px] text-muted">
      {{ resultSummary(rows.length, groups.length) }}
    </p>

    <ul v-show="rows.length > 0" id="file-search-list" ref="listEl" role="listbox" class="max-h-[360px] overflow-auto py-1">
      <template v-for="(group, at) in groups" :key="group.path">
        <!-- The heading is the anchor for everything under it, so it is the BRIGHTEST thing in the
             list. It used to be smaller and dimmer than the rows it owns, which inverted the
             hierarchy and left the two kinds of row hard to tell apart (#2159). -->
        <li
          class="flex items-baseline gap-2 px-3 pb-0.5 font-mono text-[12px] text-fg"
          :class="at > 0 ? 'mt-1.5 border-t border-border pt-2' : 'pt-1.5'"
          role="presentation"
        >
          <span class="min-w-0 truncate">{{ group.path }}</span>
          <!-- The one file whose answer did not come from disk. Said out loud because its line
               numbers are the buffer's, and the file on disk still has the old ones. -->
          <span v-if="isBufferPath(group.path)" data-testid="file-search-unsaved" class="flex-none text-[11px] text-accent">unsaved</span>
          <!-- Next to the path rather than pinned to the far right, where a column of bare `1`s
               read as decoration, and only when there is more than one to count. -->
          <span v-if="group.rows.length > 1" class="flex-none text-[11px] tabular-nums text-dim">{{ group.rows.length }} matches</span>
        </li>
        <li
          v-for="row in group.rows"
          :id="`file-search-row-${row.index}`"
          :key="`${row.match.path}:${row.match.line}`"
          :data-index="row.index"
          data-testid="file-search-row"
          role="option"
          :aria-selected="row.index === active"
          class="cursor-pointer px-3 py-[2px] font-mono text-[12px]"
          :class="row.index === active ? 'bg-hover text-fg' : 'text-secondary'"
          @pointerenter="active = row.index"
          @click="pick(row.index)"
        >
          <SearchContextLines v-if="row.index === active && activeContext" :lines="activeContext.before" data-testid="file-search-context-before" />
          <div data-testid="file-search-match-line" class="flex items-baseline gap-2">
            <span class="w-10 flex-none text-right text-[11px] tabular-nums text-dim">{{ row.match.line }}</span>
            <span class="min-w-0 truncate">
              <!-- The line has been scrolled so the match is on screen; without this mark the row
                   reads as a line that begins mid-word. -->
              <span v-if="row.view.elided" class="mr-1 text-dim">…</span>
              <span v-for="(part, index) in row.view.parts" :key="index" :class="part.hit ? 'font-bold text-accent' : ''">{{ part.text }}</span>
              <span v-if="row.match.clipped" class="text-dim"> …</span>
            </span>
          </div>
          <SearchContextLines v-if="row.index === active && activeContext" :lines="activeContext.after" data-testid="file-search-context-after" />
        </li>
      </template>
    </ul>

    <!-- Both notes are about what is NOT in the list. Silence here reads as "there is no such
         text", which is the one wrong answer a search can give. -->
    <!-- The open file was skipped, not searched-and-empty. Saying nothing would read as "there is
         nothing in that file", which is the one wrong answer a search can give — and the reader can
         act on this one by saving. -->
    <p v-if="resolved.bufferUnsearched" data-testid="file-search-buffer-skipped" class="border-t border-border px-3 py-1.5 text-[11px] text-muted">
      The file you are editing is not searched in regex mode — save it to include it.
    </p>
    <p v-if="truncated" data-testid="file-search-truncated" class="border-t border-border px-3 py-1.5 text-[11px] text-muted">
      This is not every match — narrow the search if what you want is missing.
    </p>
    <p v-if="ignoresGitignore" data-testid="file-search-unignored" class="border-t border-border px-3 py-1.5 text-[11px] text-muted">
      Not a git repository, so .gitignore is not applied.
    </p>
  </div>
</template>
