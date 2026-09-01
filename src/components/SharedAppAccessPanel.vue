<script setup lang="ts">
// WHO CAN SEE WHAT, drawn beside the collections themselves.
//
// The author's question here is not "what does my app do" — the preview answers that — it is "who
// that I did not invite can reach this". That question is asked about the collections, while
// looking at them, which is why this is a face of the collections pane and not a page of the
// preview: with Previews on you are looking at the app; with Previews off you are looking at its
// storage, and this says who else is.
//
// It reports; it authorizes nothing (see `common/sharedAppAccess.ts`). So the two rows that matter
// are drawn first and are the only ones given a colour: an author scanning this is scanning for a
// stranger's row that is not empty.
import { computed, ref, watch } from "vue";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { ACCESS_SUBJECTS, type AccessSubject, type CollectionAccess, type SharedAppAccess, type SubjectAccess } from "../../common/sharedAppAccess";
import type { PublicFace } from "../../common/sharedAppPublicFace";
import { isRecord } from "../../common/isRecord";
import { asAccess } from "../utils/sharedAppAccessPayload";

const props = defineProps<{ cwd: string | null }>();

const loading = ref(true);
const problems = ref<string[]>([]);
const failed = ref(false);
/** The app.json went away under us — not a fault, and not something to draw a table about. */
const notDeclared = ref(false);
const access = ref<SharedAppAccess | null>(null);

// A GENERATION token rather than a comparison of `cwd`, for the reason every other lookup in this
// pane has one: a cell moved between directories while a request is out, and the older answer
// landing afterwards would label THIS directory's collections with the previous one's permissions —
// which is the single worst thing a panel about permissions can do.
let generation = 0;

/** What the response MEANS, decided in one place and away from the refs it sets.
 *
 *  FOUR outcomes, and "none of them" is not one — a body that classifies as nothing left the panel
 *  blank with no state at all, which reads as a rendering fault rather than an answer. So the two
 *  shapes with nothing to say (`declared` absent, and a refusal carrying no reasons) both land on
 *  `failed`, and only a directory that genuinely stopped declaring an app gets its own quiet line. */
type Outcome = { kind: "notDeclared" } | { kind: "failed" } | { kind: "problems"; problems: string[] } | { kind: "access"; access: SharedAppAccess };

function outcomeOf(body: unknown): Outcome {
  if (!isRecord(body)) return { kind: "failed" };
  // Reachable when the manifest is removed between the pane's `/declared` probe and this request.
  if (body.declared === false) return { kind: "notDeclared" };
  if (body.declared !== true) return { kind: "failed" };
  if (body.ok === false) {
    const listed = Array.isArray(body.problems) ? body.problems.filter((entry): entry is string => typeof entry === "string") : [];
    return listed.length > 0 ? { kind: "problems", problems: listed } : { kind: "failed" };
  }
  // Narrowed rather than asserted, and a payload that does not narrow becomes the SAME failure a
  // dead server is — see `asAccess`. A permission table drawn from something we could not read is
  // the one thing worse than no table.
  const parsed = asAccess(body.access);
  return parsed === null ? { kind: "failed" } : { kind: "access", access: parsed };
}

async function load(cwd: string | null): Promise<void> {
  const mine = ++generation;
  loading.value = true;
  failed.value = false;
  notDeclared.value = false;
  problems.value = [];
  access.value = null;
  if (cwd === null) {
    loading.value = false;
    return;
  }
  try {
    const res = await fetchWithTimeout(`/api/shared-app/access?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (mine !== generation) return;
    const outcome = outcomeOf(body);
    if (outcome.kind === "notDeclared") notDeclared.value = true;
    else if (outcome.kind === "failed") failed.value = true;
    else if (outcome.kind === "problems") problems.value = outcome.problems;
    else access.value = outcome.access;
  } catch {
    if (mine === generation) failed.value = true;
  } finally {
    if (mine === generation) loading.value = false;
  }
}

watch(() => props.cwd, load, { immediate: true });

const FACE_NOTE: Record<PublicFace, string> = {
  open: "This app is OPEN. `public.enabled` is true, so anyone with the link reaches its public face.",
  declared: "This app is CLOSED. It declares a public face, but `public.enabled` is off — only the roster gets in.",
  none: "This app declares no public face. Nothing here is reachable without a role on the roster.",
};

const SUBJECT_LABEL: Record<AccessSubject, string> = {
  visitor: "Not signed in",
  stranger: "Signed in, not invited",
  participant: "Participant",
  writer: "Owner / editor",
};

const SUBJECT_NOTE: Record<AccessSubject, string> = {
  visitor: "A visitor on the public page. Firebase gives them an anonymous session, so they have a uid and no verified address.",
  stranger: "Any Google account in the world. The app id and the collection ids are world-readable, so knowing them is not a barrier.",
  participant: "On the roster, holding the role `participant` here.",
  writer: "On the roster, holding `owner` or `editor` here.",
};

/** The two rows this panel exists for. Kept as a list rather than an index comparison so the order
 *  of `ACCESS_SUBJECTS` can change without quietly moving the emphasis onto the wrong people. */
const OUTSIDERS: readonly AccessSubject[] = ["visitor", "stranger"];

const READ_LABEL = { all: "All rows", own: "Own rows", none: "Nothing" } as const;

/** The write cell, from the three permissions rather than a fourth enum: they are independent in
 *  the rules (`submitOnly` takes creation off a writer and leaves editing; `immutable` does the
 *  reverse) and any enum of the combinations is a list somebody has to keep complete. */
/** The label for the two ordinary permissions, before `mirrorRepair` is added to it. `""` is
 *  "neither", which is a different answer from "Nothing" once a repair may still be possible. */
function writeBase(entry: SubjectAccess): string {
  if (entry.create) return entry.editOwn ? "Submit, edit own" : "Submit only";
  return entry.editOwn ? "Edit own only" : "";
}

function writeLabel(entry: SubjectAccess): string {
  // A writer's `editAll` already covers the one field a repair touches, so it is the only branch
  // that does not mention it.
  if (entry.editAll) return entry.create ? "Anything" : "Edit any row";
  const base = writeBase(entry);
  // `mirrorRepair` is an ADDITION to whatever else this subject may do, not an alternative to it:
  // a visitor who may submit here may also repair `state` on somebody else's row, and a label that
  // named only the submission would be describing the smaller of the two permissions.
  if (!entry.repairMirror) return base === "" ? "Nothing" : base;
  return base === "" ? "Repair `state` only" : `${base}, repair \`state\``;
}

/** Any write at all — the test the write cell's colour uses. Not `writeLabel(...) !== "Nothing"`:
 *  a colour decided by comparing rendered English breaks the moment a label is reworded. */
const writes = (entry: SubjectAccess): boolean => entry.create || entry.editOwn || entry.editAll || entry.repairMirror;

const reaches = (entry: SubjectAccess): boolean => entry.read !== "none" || entry.create || entry.editOwn || entry.editAll || entry.repairMirror;

/** How many people the roster actually puts in this row. `null` for the two outsiders, who are not
 *  a group anyone is enrolled in — printing "0 people" beside a stranger would read as "nobody can
 *  do this", which is the opposite of what their row is for. */
function headcount(collection: CollectionAccess, subject: AccessSubject): number | null {
  if (subject === "participant") return collection.census.participants;
  if (subject === "writer") return collection.census.writers;
  return null;
}

const AUTH_LABEL = { none: "no sign-in required", anonymous: "any session", verifiedEmail: "verified email" } as const;

/** Collections whose two outsider rows are both empty, counted for the summary line: an author
 *  with fifteen collections wants to be told the number that are shut before reading the table. */
const shutToOutsiders = computed(
  () => (access.value?.collections ?? []).filter((collection) => OUTSIDERS.every((subject) => !reaches(collection.access[subject]))).length,
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-3 font-sans text-[11px]">
    <div v-if="loading" class="text-dim">Working out who can see what…</div>
    <div v-else-if="failed" class="text-err-text">Could not work out the access summary.</div>
    <div v-else-if="notDeclared" class="text-dim">This directory no longer declares a shared app, so it grants nobody anything.</div>
    <div v-else-if="problems.length" class="flex flex-col gap-1">
      <span class="text-err-text">The declaration could not be read.</span>
      <span v-for="problem in problems" :key="problem" class="leading-[1.4] text-dim">{{ problem }}</span>
    </div>
    <template v-else-if="access">
      <!-- THE SWITCH, first and on its own. Every cell below is downstream of it: with
           `public.enabled` off, a `public.submit` declaration grants a stranger nothing, and that
           is exactly the pair an author reads the wrong way round (#1926). -->
      <p class="m-0 leading-[1.45]" :class="access.publicFace === 'open' ? 'text-amber' : 'text-dim'" :data-testid="`access-face-${access.publicFace}`">
        {{ FACE_NOTE[access.publicFace] }}
      </p>
      <p v-if="access.collections.length" class="m-0 mt-1 text-dim">
        {{ shutToOutsiders }} of {{ access.collections.length }} collections are shut to everyone outside the roster.
      </p>

      <!-- Coloured, because it is a permission the author believes they granted and did not. The
           rules compare an address exactly, so a capital letter on the roster grants nothing and
           the file still reads correctly to a human. -->
      <p v-if="access.unmatchableRoster.length" class="m-0 mt-1 leading-[1.45] text-amber" data-testid="access-unmatchable-roster">
        {{ access.unmatchableRoster.length }} roster {{ access.unmatchableRoster.length === 1 ? "address is" : "addresses are" }} written with capitals and
        grant nothing — the rules compare an address exactly. Counted nowhere below: {{ access.unmatchableRoster.join(", ") }}
      </p>

      <div v-if="!access.collections.length" class="mt-3 text-dim">This app publishes no collections yet.</div>

      <section v-for="collection in access.collections" :key="collection.cid" class="mt-4" :data-testid="`access-collection-${collection.cid}`">
        <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span class="font-semibold text-fg">{{ collection.cid }}</span>
          <span class="text-dim">
            {{ collection.takesSubmissions ? `takes submissions — ${AUTH_LABEL[collection.authStage]}` : "no submission path declared" }}
          </span>
        </div>
        <!-- Three columns, not four subjects across: this pane is a cell's side panel and is
             routinely half a screen wide. Down the page the two outsiders stay side by side with
             the people who were invited, which is the comparison being made. -->
        <table class="mt-1 w-full border-collapse text-left">
          <thead>
            <tr class="text-dim">
              <th scope="col" class="w-[46%] py-0.5 pr-2 font-normal">Who</th>
              <th scope="col" class="py-0.5 pr-2 font-normal">Reads</th>
              <th scope="col" class="py-0.5 font-normal">Writes</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="subject in ACCESS_SUBJECTS" :key="subject" class="border-t border-border align-top" :data-testid="`access-${collection.cid}-${subject}`">
              <th scope="row" class="py-1 pr-2 font-normal" :class="OUTSIDERS.includes(subject) ? 'text-fg' : 'text-dim'" :title="SUBJECT_NOTE[subject]">
                {{ SUBJECT_LABEL[subject] }}<span v-if="headcount(collection, subject) !== null" class="text-dim"> ({{ headcount(collection, subject) }})</span>
              </th>
              <!-- COLOUR ONLY ON THE OUTSIDERS, and only where they reach something. A participant
                   reading their own rows is the app working; a stranger doing it is the thing the
                   author opened this panel to check, and a table where everything is highlighted
                   highlights nothing. -->
              <td class="py-1 pr-2" :class="OUTSIDERS.includes(subject) && collection.access[subject].read !== 'none' ? 'text-amber' : 'text-dim'">
                {{ READ_LABEL[collection.access[subject].read] }}
              </td>
              <td class="py-1" :class="OUTSIDERS.includes(subject) && writes(collection.access[subject]) ? 'text-amber' : 'text-dim'">
                {{ writeLabel(collection.access[subject]) }}
              </td>
            </tr>
          </tbody>
        </table>
        <!-- Each of these can only NARROW the table above it, never widen it — so an author who
             stops reading here has an answer that is too generous rather than too tight. -->
        <ul v-if="collection.caveats.length" class="mt-1 flex list-none flex-col gap-0.5 p-0 text-dim">
          <li v-for="caveat in collection.caveats" :key="caveat" class="leading-[1.4]">{{ caveat }}</li>
        </ul>
        <p v-if="collection.census.readers" class="m-0 mt-1 text-dim">
          {{ collection.census.readers }} more on the roster read every row here as `viewer` or `assignee`.
        </p>
      </section>

      <p class="m-0 mt-4 leading-[1.45] text-dim">
        Read off the two documents the Firestore rules read — the app document and its `public` block — as publishing this directory would write them. The
        deployed rules are what actually decide; if they disagree with this table, they win and this is the bug.
      </p>
    </template>
  </div>
</template>
