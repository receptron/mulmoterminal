<script setup lang="ts">
// The collections of ONE cell's directory, in the cell's right pane beside Canvas / Tools /
// Files. There is no project picker: a Project IS a directory
// (plans/project-architecture.md D2), and the cell already names one — the pane shows that
// cell's, which is why it sits in the selector rather than in a menu of its own.
//
// Navigation is CONTAINED. The pane registers itself as the collection nav surface while it is
// mounted (collectionNavSurface.ts), so opening a collection here moves this pane and not the
// app's route; the full-screen overlay is unaffected and unaware.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { CollectionsIndexView, CollectionView, FeedsView } from "@mulmoclaude/collection-plugin/vue";
import PluginFrame from "./PluginFrame.vue";
import { collectionShadowCss } from "../collectionShadowCss";
import { useCollectionTeleportTarget } from "../composables/useCollectionTeleportTarget";
import { pushCollectionSurface, popCollectionSurface, type CollectionNavSurface, type CollectionSurface } from "../composables/collectionSurface";
import { projectIdForCwd } from "../composables/collectionProject";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { asSelfContainmentReport, type SelfContainmentReport, type SelfContainmentSeverity } from "../../common/collectionPortability";
import type { ShortcutKind } from "../../common/shortcuts";
import SharedAppPreview from "./SharedAppPreview.vue";
import { isRecord } from "../../common/isRecord";

const props = defineProps<{ cwd: string | null; expanded?: boolean }>();

// The pane-slot contract, the same one Tools / Canvas / Prompts / GitHub answer: the grid owns
// the width and which pane is open, so both controls report rather than act.
const emit = defineEmits<{ close: []; toggleExpand: [] }>();

// ── this pane's own view state (the router's job, done locally) ──
type PaneView = { mode: "index"; kind: ShortcutKind } | { mode: "detail"; kind: ShortcutKind; slug: string };
const view = ref<PaneView>({ mode: "index", kind: "collection" });
const selectedId = ref<string | null>(null);

const nav: CollectionNavSurface = {
  routeSlug: () => (view.value.mode === "detail" ? view.value.slug : undefined),
  routeSelectedId: () => selectedId.value ?? undefined,
  isFeedRoute: () => view.value.kind === "feed",
  setSelectedId: (itemId) => {
    selectedId.value = itemId;
  },
  gotoIndex: (kind) => {
    selectedId.value = null;
    view.value = { mode: "index", kind };
  },
  gotoDetail: (kind, slug) => {
    selectedId.value = null;
    view.value = { mode: "detail", kind, slug };
  },
  // A ref hop from one record to another: same pane, the target collection open with that record
  // selected. `recordId` is optional because a hop may target the collection itself.
  navigateToRecord: (targetSlug, recordId) => {
    view.value = { mode: "detail", kind: "collection", slug: targetSlug };
    selectedId.value = recordId ?? null;
  },
};

// ── the project this pane is scoped to ──
// null while resolving, and null-after-resolving when the cell's directory is not one the server
// knows. Those are different states to the user, so they are different values here.
const resolving = ref(true);
const projectId = ref<string | null>(null);

// THE surface this pane is, registered for as long as it is mounted. Scope and navigation travel
// together (collectionSurface.ts): registering only the nav is what let a mounted pane keep the
// project for the full-screen overlay opened over it.
const surface: CollectionSurface = { projectId: null, nav };
pushCollectionSurface(surface);
onBeforeUnmount(() => popCollectionSurface(surface));

// A GENERATION token, not just an await. The lookup is async, so a cwd change or an unmount while
// one is in flight would otherwise let the older completion write its answer over the newer one —
// or over the cleanup — leaving the pane scoped to a directory it is no longer showing.
let generation = 0;
watch(
  () => props.cwd,
  async (cwd) => {
    const mine = ++generation;
    resolving.value = true;
    const resolved = await projectIdForCwd(cwd);
    if (mine !== generation) return;
    projectId.value = resolved;
    resolving.value = false;
    surface.projectId = resolved;
    // The project half of the report's identity just changed, so anything in flight is about a
    // pair that is no longer on screen — including a check for a slug that exists in BOTH.
    invalidateCheck();
    // The app is the DIRECTORY's, so a cwd change is a different app or none.
    void probeForApp(cwd ?? null);
    // Reset the view: a slug open in one directory need not exist in the next.
    nav.gotoIndex("collection");
  },
  { immediate: true },
);

const unknownDirectory = computed(() => !resolving.value && projectId.value === null);

// ── "what would publishing this app show?" ──
//
// A shared app is declared by an `app.json` in the cell's directory, so the control appears only
// where there is one — most directories are not shared apps, and a button that answers "there is
// no app here" on every one of them is a button nobody reads.
//
// The probe is a separate, cheap route (one `stat`). Asking the preview route would compute a
// whole publish projection, and open a Firestore session, to decide whether to draw a button.
const declaresApp = ref(false);
const previewing = ref(false);

let probeGeneration = 0;
async function probeForApp(cwd: string | null): Promise<void> {
  const mine = ++probeGeneration;
  declaresApp.value = false;
  previewing.value = false;
  if (cwd === null) return;
  try {
    const res = await fetchWithTimeout(`/api/shared-app/declared?cwd=${encodeURIComponent(cwd)}`);
    const body: unknown = await res.json();
    if (mine !== probeGeneration) return;
    declaresApp.value = isRecord(body) && body.declared === true;
    // In a directory that IS a shared app, the app is what the pane is for: the pages are the
    // thing being worked on and the collections underneath them are its storage. So the preview
    // is the DEFAULT view here, not a control you have to find — the collections stay one click
    // away on the toolbar.
    //
    // Only while the pane is still on its own index, though. The probe is async, and a user who
    // has already opened a collection in the meantime has said what they want to look at; taking
    // the screen off them after the fact is worse than not defaulting at all.
    if (declaresApp.value && view.value.mode === "index") previewing.value = true;
  } catch {
    // A directory whose app-ness could not be established simply shows no preview control. There
    // is nothing to tell the user here: they did not ask a question.
  }
}

// ── "would this collection survive a clone?" ──
//
// The check is surfaced HERE and nowhere else, because here is the only place someone is looking
// at one collection of one project — which is exactly the pair the question is about. It is a
// button rather than something computed on open: the answer changes without the collection
// changing (a `.gitignore` line lands, `git init` runs, the skill moves into the project), so
// asking on every render would be both wrong and chatty, and asking never is how #1582 shipped a
// check nothing could reach.
const report = ref<SelfContainmentReport | null>(null);
const checking = ref(false);
const checkFailed = ref(false);

/** The open collection, or undefined on the index — the check is per collection. */
const openSlug = computed(() => (view.value.mode === "detail" && view.value.kind === "collection" ? view.value.slug : undefined));

// A GENERATION token, like the project lookup above it, and for a reason a slug comparison cannot
// cover: the pair this report describes is (project, collection), and BOTH can change under an
// in-flight request. Comparing the slug alone lets project A's verdict land on project B's
// identically-named collection — the same-slug-in-two-roots collision this whole feature is
// about, arriving through a race instead of through a path.
let checkGeneration = 0;

/** Abandon any in-flight check and drop what it was about. Also releases `checking`: the user is
 *  now looking at a different (project, collection) and must be able to ask about THAT one while
 *  the superseded request is still out. */
function invalidateCheck(): void {
  checkGeneration += 1;
  report.value = null;
  checkFailed.value = false;
  checking.value = false;
}

// Leaving the collection drops its report: a verdict that outlived the thing it was about would
// read as this collection's. The project half is invalidated in the cwd watcher above.
watch(openSlug, invalidateCheck);

async function checkPortability(): Promise<void> {
  const slug = openSlug.value;
  if (!slug || checking.value) return;
  const mine = ++checkGeneration;
  checking.value = true;
  checkFailed.value = false;
  report.value = null;
  try {
    // THIS PANE's project, not the ambient surface's: an overlay opened over this pane is the
    // active surface, and the question is about the collection on screen here.
    const scoped = projectId.value === null ? "" : `?project=${encodeURIComponent(projectId.value)}`;
    const res = await fetchWithTimeout(`/api/collections/${encodeURIComponent(slug)}/self-containment${scoped}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = asSelfContainmentReport(await res.json());
    if (!parsed) throw new Error("unrecognised report");
    if (mine === checkGeneration) report.value = parsed;
  } catch {
    if (mine === checkGeneration) checkFailed.value = true;
  } finally {
    // Only the CURRENT check owns the flag — a superseded one clearing it would end the spinner
    // for a request that is still out.
    if (mine === checkGeneration) checking.value = false;
  }
}

/** Whether to TELL the user it travels — the report's verdict, corrected by a blocker this build
 *  can read.
 *
 *  `portable` and the findings can contradict each other, and the two directions want opposite
 *  treatment. A non-portable report with no readable reason is trusted: a newer server may
 *  disqualify on something this build cannot describe, and refusing to say so would replace a
 *  wrong answer with none. A portable report carrying a BLOCKER is not trusted: the contradiction
 *  is visible from here, and of the two readings the safe one is the blocker — a false "it
 *  travels" is discovered by someone else, on another machine, days later. */
const travels = computed(() => report.value !== null && report.value.portable && !report.value.findings.some((finding) => finding.severity === "blocker"));

const SEVERITY_CLASS: Record<SelfContainmentSeverity, string> = {
  blocker: "text-err-text",
  warning: "text-amber",
  info: "text-dim",
};

// The probe sits inside the PluginFrame shadow, which is what lets the composable resolve
// this pane's shadow root as the record modal's teleport target.
const probe = ref<HTMLElement>();
useCollectionTeleportTarget(probe);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-panel" role="region" aria-label="Collections">
    <!-- The header recipe is the shared one — `bg-panel px-4 py-2 text-[14px]` with a bold title at
         the left, exactly as Tools, Prompts, Question and Canvas have it. The panes take turns in
         one slot, so a header of its own height or padding makes the whole pane jump as you switch
         between them. The `border-b` is this pane's only addition: the others separate header from
         body by background (bg-panel over bg-deep) and this one's body is bg-panel too.

         The TOOLBAR is ALWAYS here — outside every state below it, because the
         controls on its right are how the pane is resized and closed and those must not depend on
         whether a directory resolved, declares an app, or is showing the preview. It used to render
         only for a directory declaring a shared app, which meant the bar itself came and went as
         you moved between cells and there was nowhere to put a control that is not about apps.

         The control on the LEFT switches what fills the pane: "Previews" ON is the app's pages,
         OFF is the collections underneath them. A checkbox rather than a button because it is a
         state you can see the value of without pressing it. It appears only where an `app.json`
         declares a shared app — everywhere else there are no pages and nothing to switch — and it
         sits here rather than in the collection strip at the bottom because it is about the APP,
         every collection it publishes and the pages built over them, not about the one collection
         on screen. It starts ON: in a directory that IS a shared app, the pages are the thing
         being worked on and the collections are their storage. -->
    <div class="flex-none border-b border-border bg-panel px-4 py-2 font-sans text-[14px] text-fg">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="font-semibold">Collections</span>
          <label
            v-if="declaresApp"
            class="flex cursor-pointer items-center gap-1.5 text-[11px] text-dim"
            title="Draw the pages publishing this app would put on screen. Nothing is written."
          >
            <input v-model="previewing" data-testid="collections-preview-toggle" type="checkbox" class="h-3.5 w-3.5 cursor-pointer accent-accent" />
            Previews
          </label>
        </div>
        <!-- Expand then close, in that order and with the same icons and classes as the Tools and
             Canvas headers: the panes share one slot, so the same control must be in the same
             place in each of them. -->
        <div class="flex items-center gap-1">
          <button
            type="button"
            data-testid="collections-expand-btn"
            class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
            :title="expanded ? 'Restore the terminal beside the collections' : 'Expand the collections over the terminal'"
            :aria-label="expanded ? 'Restore collections pane width' : 'Expand collections pane'"
            :aria-pressed="expanded === true"
            @click="emit('toggleExpand')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ expanded ? "close_fullscreen" : "open_in_full" }}</span>
          </button>
          <button
            type="button"
            data-testid="collections-close-btn"
            class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
            title="Close collections pane"
            aria-label="Close collections pane"
            @click="emit('close')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="resolving" class="px-4 py-3 font-sans text-[12px] text-dim">Loading collections…</div>
    <!-- Not an error, and deliberately not the workspace's collections under this cell's name:
         a directory the server does not know has no collections of its own to show. -->
    <div v-else-if="unknownDirectory" class="px-4 py-3 font-sans text-[12px] text-dim">
      This directory has no collections yet. Collections live in <code>.claude/skills</code> under the folder the cell is open in.
    </div>
    <div v-else-if="previewing" class="min-h-0 flex-1">
      <SharedAppPreview :cwd="cwd" />
    </div>
    <template v-else>
      <div class="min-h-0 flex-1">
        <PluginFrame :css="collectionShadowCss" height="100%">
          <div ref="probe" style="height: 100%">
            <FeedsView v-if="view.mode === 'index' && view.kind === 'feed'" />
            <CollectionsIndexView v-else-if="view.mode === 'index'" />
            <CollectionView v-else />
          </div>
        </PluginFrame>
      </div>
      <!-- The portability check, on a strip of its own below the plugin's own surface: it is the
           HOST's question about the collection (does it survive a clone), not part of the
           collection's data, and it must not be inside the shadow root the package styles. -->
      <div v-if="openSlug" class="flex-none border-t border-border px-4 py-2 font-sans">
        <div class="flex items-center gap-2">
          <button
            type="button"
            data-testid="collections-portability-btn"
            class="cursor-pointer rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg hover:border-accent disabled:cursor-default disabled:opacity-60"
            :disabled="checking"
            :aria-busy="checking"
            title="Check whether this collection would still work after a git clone on another machine"
            @click="checkPortability"
          >
            {{ checking ? "Checking…" : "Survives a clone?" }}
          </button>
        </div>
        <!-- A LIVE REGION, and always present rather than rendered with the result: focus stays on
             the button across the whole check, so a verdict that merely appears is a verdict a
             screen-reader user is never told. `polite` because it answers something they asked
             for and interrupts nothing. It wraps the findings too — the list IS the answer, not a
             decoration on it. -->
        <div role="status" aria-live="polite" class="mt-1">
          <span v-if="checkFailed" class="text-[11px] text-err-text">Could not run the check.</span>
          <!-- The VERDICT decides first (see `travels`): a report can be non-portable with no
               finding this build can read, and "nothing to fix" is the one thing that must never
               be said about it — nor may "it travels" be said over a blocker we CAN read. -->
          <span v-else-if="report && !travels" class="text-[11px] text-err-text">Would not survive a clone</span>
          <span v-else-if="report && report.findings.length === 0" class="text-[11px] text-dim">Nothing to fix — it travels.</span>
          <span v-else-if="report" class="text-[11px] text-amber">Travels, with caveats</span>
          <!-- The MESSAGE, not the code: each one says what breaks on the other machine, which is
               the part that tells someone what to do about it. -->
          <ul v-if="report && report.findings.length" class="mt-1.5 flex list-none flex-col gap-1 p-0">
            <li v-for="finding in report.findings" :key="finding.code" class="text-[11px] leading-[1.4]" :class="SEVERITY_CLASS[finding.severity]">
              {{ finding.message }}
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
