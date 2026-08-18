<script setup lang="ts">
// The author's shared app, running on the author's own machine, before anything is published.
//
// Until this existed the page was written by an LLM and went out without anybody having loaded it
// once. This is where it loads (design: `plans/feat-shared-app-preview.md`).
//
// THE PARENT IS NOT OURS. Every rule about what a view may ask for, when a write may happen and
// which document may be answered lives in `@receptron/sharedapp/view` — the same code mulmoserver
// runs at `/a/{slug}`. Writing a second parent here would have been quicker and would have made
// this a different program from the one visitors meet: it would agree on the easy things and
// diverge on a dropped port message, a confirmation that is not drawn, a modal the sandbox
// ignores. What stays here is this host's chrome, and nothing else.
//
// AND IT IS NOT LOOSER. Same `sandbox="allow-scripts"` with no `allow-modals` and no
// `allow-same-origin`, same CSP, same per-render nonce, same handover of a private port. A preview
// that were kinder than production is a machine for manufacturing "it worked on my machine", and
// worse than having none.
//
// What this does NOT show is worth knowing before trusting it: the rules do not run here, so what
// a role may WRITE is not tested; nobody else exists, so nothing here is concurrent; and it cannot
// tell whether the Firestore rules a new declaration needs have been deployed at all.
import { computed, onBeforeUnmount, ref, shallowRef, toRaw, watch } from "vue";
import { memberBridge, portChannel, publicViewSrcdoc, viewBridge, viewNonce, VIEW_MESSAGE, type PendingSubmit, type Viewer } from "@receptron/sharedapp/view";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { isRecord } from "../../common/isRecord";
import { createPreviewLog, renderPreviewLog, type PreviewLogEvent } from "../utils/sharedAppPreviewLog";
import { useUpdateStatus } from "../composables/useUpdateStatus";
import {
  previewPageKey,
  type PreviewAudience,
  type PreviewForm,
  type PreviewPage,
  type PreviewUncertainWrite,
  type PreviewWrittenRecord,
  type SharedAppPreview,
} from "../../common/sharedAppPreview";

// `pickerTarget` is where the PAGE PICKER goes. The pane that hosts this preview has a toolbar of
// its own, and a strip of chrome directly under it was two toolbars saying different halves of one
// thing — so the host hands us an element in its toolbar and the picker is teleported into it.
// Left unset (a standalone mount, and the specs) the picker renders in place, as it used to.
const props = defineProps<{ cwd: string | null; pickerTarget?: HTMLElement | null }>();

import { asPayload } from "../utils/sharedAppPreviewPayload";

const loading = ref(true);
const declared = ref(false);
const problems = ref<string[]>([]);
const payload = shallowRef<SharedAppPreview | null>(null);
const selectedId = ref<string | null>(null);

const AUDIENCE_LABEL: Record<PreviewPage["audience"], string> = {
  public: "Anyone with the link",
  member: "On the roster",
  roster: "The person who signed up",
};

const pages = computed<PreviewPage[]>(() => payload.value?.pages ?? []);

/** The key the picker binds to. Audience-qualified for the same reason the datasets are: a view id
 *  is unique inside its tier, not across them. */
const keyOf = (candidate: PreviewPage): string => previewPageKey(candidate.audience, candidate.id);

const page = computed(() => pages.value.find((candidate) => keyOf(candidate) === selectedId.value) ?? pages.value[0] ?? null);

/** ONLY this page's records. A member page may name a collection `public.read` does not open, so
 *  one map for the app would either starve that page or hand its rows to the public one — and the
 *  second would show the author a public page drawing private data. */
const datasets = computed(() => (page.value === null ? {} : (payload.value?.datasets[keyOf(page.value)] ?? {})));

/** A fresh name per rendered document, for the reason the package gives: reusing one would let a
 *  document that navigated away go on answering. */
const nonce = ref(viewNonce());
const srcdoc = computed(() => (page.value === null ? "" : publicViewSrcdoc(page.value.html, nonce.value)));

const frame = ref<HTMLIFrameElement | null>(null);

// The bridge's state, owned HERE. The package holds no framework of its own so that a second copy
// of Vue cannot end up on a page — see its own note — so the cells are this host's `ref`s.
const cells = { pending: ref<PendingSubmit | null>(null), sending: ref(false), readied: ref(false) };

// WHAT HAPPENED, kept so it can be handed to whoever is fixing the page.
//
// Everything below already passes through this component and is then thrown away: a refusal is
// answered on the port and never drawn, an error inside the frame dies at the frame boundary, and
// the deployed rules' refusal lives in `formError[cid]` until the next attempt overwrites it. The
// author is left with "it seems stuck", which is the only thing they can carry back to the LLM
// that wrote the page — and that LLM is the one participant that never runs it.
//
// Always on. "Turn on recording and reproduce it" costs a round trip and misses the first time,
// which is the one that was surprising (`plans/feat-collection-pane-diagnostics.md`).
const log = createPreviewLog();
/** The array is NOT reactive — a page in an error loop would otherwise redraw the pane on every
 *  throw — so these two are what the UI binds to. */
const logSize = ref(0);
const logProblems = ref(0);

function remember(event: PreviewLogEvent): void {
  log.add(event);
  logSize.value = log.size();
  logProblems.value = log.problems();
}

/** WHICH APP the entries belong to. The buffer is scoped to it and emptied when it changes.
 *
 *  Not a tidiness: the header names one app and one directory, so entries carried over from the
 *  previous one would be REPORTED as this one's — an author debugging app B handed a block that
 *  says app B and describes app A. And the block is built to be pasted elsewhere, so that is also
 *  one app's diagnostics leaving inside another's. */
let logScope: string | null = null;

function resetLog(scope: string | null): void {
  log.clear();
  logSize.value = 0;
  logProblems.value = 0;
  logScope = scope;
}

/** Adopt the app a payload belongs to, emptying the log if it is a different one.
 *
 *  Called where a payload LANDS rather than where one is asked for, so re-reading the same app —
 *  which happens after every write and after Remove them — keeps what was recorded. Losing the log
 *  to a refresh would lose it at exactly the moment an author had finished reproducing something. */
function scopeLog(aid: string): void {
  const scope = `${props.cwd ?? ""}::${aid}`;
  if (logScope === scope) return;
  if (logScope !== null) resetLog(scope);
  logScope = scope;
}

/** The collection of the confirmation most recently raised.
 *
 *  Kept because a cancellation is answered AFTER the confirmation has been settled: the bridge
 *  clears the cell and then posts, so the only moment `pending` names the collection is before the
 *  answer this component is watching for. */
let lastPending = "";

/** The audience of the page being drawn, for the refusals whose meaning depends on it. */
const audienceNow = (): PreviewAudience => page.value?.audience ?? "public";

/** Every message the parent sends, on its way out.
 *
 *  This is the only place a refusal can be seen. The bridge answers it on the port, into a promise
 *  the page usually does not await, so on screen it is a button that did nothing — the exact
 *  symptom this pane exists to explain. */
function noteOutbound(message: Record<string, unknown>): void {
  if (message.type === VIEW_MESSAGE.state && isRecord(message.collections)) {
    const datasets = Object.entries(message.collections).map(([cid, rows]) => ({ cid, rows: Array.isArray(rows) ? rows.length : 0 }));
    remember({ kind: "state", datasets });
    return;
  }
  if (message.type !== VIEW_MESSAGE.result || message.ok !== false) return;
  const reason = typeof message.error === "string" ? message.error : "unknown";
  // Declining is not a fault and is not reported as one — the author pressed Cancel.
  if (reason === "cancelled") {
    // The LAST one asked for, not the one still open: `decline()` settles the confirmation before
    // it posts this answer, so by the time this runs `pending` is already null and reading it named
    // an empty collection on every cancellation.
    remember({ kind: "declined", cid: lastPending });
    return;
  }
  remember({ kind: "refused", reason, audience: audienceNow() });
}

const bridge = viewBridge(
  {
    channel: () => {
      // Wrapped rather than replaced: what may travel and when is the package's, and this only
      // watches it go past.
      const channel = portChannel(frame.value, (message) => structuredCloneable(message));
      return {
        post: (message) => {
          noteOutbound(message);
          channel.post(message);
        },
        onMessage: channel.onMessage,
        close: channel.close,
      };
    },
    // WHAT THE FRAME SAYS ABOUT ITSELF: an uncaught error, a rejected promise nobody handled, a
    // modal the sandbox ignored. None of the three reaches this side without it, and the third does
    // not even fail — `confirm` answers false and the page carries on as though the visitor had
    // said no. Taken HERE and not on the published page: the reader is the author, on their own
    // machine, which is what makes it safe to keep a string the page wrote.
    notice: (report) => remember({ kind: "notice", code: report.code, detail: report.detail }),
    // The REAL write, to the real database, performed by the server as the author.
    //
    // A submission only reaches this after the parent has judged it against the declaration below
    // and a person has pressed a button: `unknown-collection`, `not-a-submission` and
    // `undeclared-field` are answered before it, which is what a preview is FOR.
    submit: (pending) => send(pending.cid, pending.values),
    state: () => datasets.value,
  },
  // The REAL declaration, never an empty map.
  //
  // An empty one does not switch the check off — it makes the parent refuse every submission with
  // `unknown-collection`, which reads as "the cid your page submits to is not declared" about a
  // declaration that is correct. That shipped, and it sent an author debugging the wrong
  // repository: the page was fine, the app was fine, and the preview was the only thing wrong.
  () => (payload.value === null ? null : { submit: payload.value.submit }),
  () => nonce.value,
  cells,
);

/** Vue's reactivity taken off a message before the browser copies it. Structured clone refuses a
 *  Proxy, and these datasets arrive through a ref — the failure is a `DataCloneError` at the send,
 *  which leaves the view on "loading…" with nothing on screen to say why.
 *
 *  Rebuilt entry by entry rather than unwrapped whole, so the shape is preserved by construction
 *  and nothing has to be asserted back into it. */
function structuredCloneable(message: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(message).map(([key, value]) => [key, unwrap(value)]));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Recursive because `toRaw` unwraps one level. Anything that is not a plain container is passed
 *  through untouched — structured clone copies a class instance's own fields by itself, and going
 *  through JSON instead would turn `NaN` and `±Infinity` into `null`. */
const unwrap = (value: unknown): unknown => {
  const raw: unknown = toRaw(value);
  if (Array.isArray(raw)) return raw.map(unwrap);
  if (isPlainObject(raw)) return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, unwrap(entry)]));
  return raw;
};

/** The parent a MEMBER's page gets: the roster and participant pages, which is what `/m/` and
 *  `/p/` put in front of the same HTML.
 *
 *  A second bridge rather than a flag, because a member's ask is not a submission — see
 *  `memberBridge` in the package. What matters here is that it is the package's and not this
 *  pane's: while there was only the public one to reach for, a member page previewed here was sent
 *  a state message with no `viewer` key at all, the injected runtime read `data.viewer || {}`, and
 *  the page drew none of its buttons. That is indistinguishable from an author who got the
 *  capability names wrong, and it was diagnosed as exactly that.
 *
 *  It performs NOTHING. A transition, an assignment or a withdrawal is a real write against the
 *  live rules and the pane has no route for one, so every intent is refused — by name, on the
 *  channel, which the strip below reports. That is the honest answer and it is not silence. */
const member = memberBridge(
  {
    channel: () => {
      const channel = portChannel(frame.value, (message) => structuredCloneable(message));
      return {
        post: (message) => {
          noteOutbound(message);
          channel.post(message);
        },
        onMessage: channel.onMessage,
        close: channel.close,
      };
    },
    state: () => datasets.value,
    // NO FLOOR. This parent is chosen only for a page that HAS a viewer (see `memberPage`), so
    // there is nothing to fall back to — and inventing `{ me: null, can: {} }` here is the exact
    // bug this whole change removes: a page drawing no controls, with nothing anywhere saying why.
    viewer: () => page.value?.viewer ?? UNRESOLVED_VIEWER,
    // The SAME cell the public parent writes, so the handshake is logged whichever parent answered
    // it. Watched below rather than recorded here: the cell is what the bridge actually writes, so
    // nothing can move without the log seeing it.
    readied: cells.readied,
    // The same log the public parent writes to. A member page can throw before it ever readies —
    // the page that sits on its loading state — and without this the pane would report that page
    // as silent, which is the one thing it exists not to do.
    notice: (report) => remember({ kind: "notice", code: report.code, detail: report.detail }),
  },
  () => nonce.value,
);

/** Answering a `viewer` question for a page that has none. Unreachable — `memberPage` is what
 *  selects this parent and it requires one — and here so that a future change which loses that
 *  guarantee produces an empty-capability page WITH a line in the log above, rather than the silent
 *  no-controls page this whole change removes. */
const UNRESOLVED_VIEWER: Viewer = { me: null, can: {} };

/** Which parent is talking to the document on screen.
 *
 *  The audience decides WHICH parent a page should have — `/a/` is the public one, `/m/` and `/p/`
 *  are the member's, exactly as the address decides it in production. But the member parent needs
 *  capabilities to be worth choosing, so the test is that the payload actually carried them: a
 *  member page without a `viewer` would otherwise be handed an empty one and draw no controls,
 *  which is the failure being fixed rather than a smaller version of the fix.
 *
 *  That case is REPORTED. Falling back to the public parent quietly would put an author back in
 *  front of the same blank page with nothing to read — and the cause is not in their page at all,
 *  it is a host too old to resolve capabilities, or a payload this pane could not narrow. */
const memberPage = computed(() => page.value !== null && page.value.audience !== "public" && page.value.viewer !== undefined);

/** Only messages from OUR frame. The sandbox's origin is opaque, so `event.origin` cannot draw
 *  this boundary and `event.source` is what does. */
const onMessage = (event: MessageEvent) => {
  if (frame.value === null || event.source !== frame.value.contentWindow) return;
  if (memberPage.value) {
    member.receive(event.data);
    return;
  }
  bridge.receive(event.data);
};
window.addEventListener("message", onMessage);
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  bridge.restart();
  member.forget();
});

// A new document means a new conversation: the old channel belongs to a document we are no longer
// talking to, and the next `ready` is a real first one.
//
// Watched on the HTML, never on `srcdoc`. `srcdoc` is computed FROM the nonce, so minting one here
// would change what is being watched and trigger this again — an infinite loop rather than a
// preview. The document's identity is the page; the nonce is a consequence of it.
// The handshake and the confirmation, as facts with a time on them. Watched rather than recorded at
// the call sites: the cells are what the bridge actually writes, so nothing can move without this
// seeing it.
watch(cells.readied, (readied) => {
  if (readied) remember({ kind: "handshake" });
});
watch(cells.pending, (pending) => {
  if (pending === null) return;
  lastPending = pending.cid;
  remember({ kind: "submitted", cid: pending.cid, fields: Object.keys(pending.values) });
});

watch(
  // The PAGE, not its HTML. Two pages can hold byte-identical HTML — a member page and a roster
  // page built from the same template — and watching the text would then keep the old document, its
  // nonce and its channel while handing it the other page's datasets. The key is audience-qualified
  // for the same reason the datasets are.
  () => (page.value === null ? null : keyOf(page.value)),
  () => {
    // BOTH, always. The page that is going may have been the other audience's, and a channel left
    // open belongs to a document nobody is looking at any more.
    bridge.restart();
    member.forget();
    nonce.value = viewNonce();
    // NOT a reset of the log. Switching pages is part of what the author was doing, and the page
    // they came from is often where the fault is — a member page that never readied looks identical
    // to one nobody opened.
    if (page.value !== null) remember({ kind: "page", id: page.value.id, audience: page.value.audience });
    // Said once per page, and counted as a problem: everything below it is a report about a page
    // running under the wrong parent.
    if (page.value !== null && page.value.audience !== "public" && page.value.viewer === undefined) {
      remember({
        kind: "host",
        note: "this page is written for the roster but arrived with no capabilities, so it is being run under the PUBLIC parent — it will be sent no `viewer` and its member controls cannot work. The page is not at fault: either this server could not resolve them, or its answer was in a shape this pane could not read.",
      });
    }
  },
);

// New data, same document — the view asked once and cannot ask again. Sent to whichever parent
// holds the conversation; the other one has no open channel and its call is a no-op.
watch(
  datasets,
  () => {
    bridge.sendState();
    member.sendState();
  },
  { deep: true },
);

/** Every record this preview session wrote, newest first.
 *
 *  HERE and not on the records. The rules read a public create with `hasOnly(createFields)`, so an
 *  extra key does not annotate the document — it refuses the whole write. What the author wrote
 *  from a preview is therefore indistinguishable in the database from what a visitor wrote, and
 *  this list is the only place it can be remembered. It dies with the pane, which is why the button
 *  below says so. */
const written = ref<(PreviewWrittenRecord | PreviewUncertainWrite)[]>([]);

/** A record this pane can name, as against one it only knows the collection of. */
const isNamed = (entry: PreviewWrittenRecord | PreviewUncertainWrite): entry is PreviewWrittenRecord => !("uncertain" in entry);
const clearing = ref(false);

/** The projection route, scoped to the cell's directory. */
const previewUrl = (): string => {
  const scope = props.cwd === null ? "" : `?cwd=${encodeURIComponent(props.cwd)}`;
  return `/api/shared-app/preview${scope}`;
};

const writeUrl = (path: string): string => {
  const scope = props.cwd === null ? "" : `?cwd=${encodeURIComponent(props.cwd)}`;
  return `/api/shared-app/preview/${path}${scope}`;
};

/** Perform one accepted submission and remember what it made. */
async function send(cid: string, values: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      writeUrl("submit"),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cid, values }) },
      SLOW_COMMAND_TIMEOUT_MS,
    );
    const body: unknown = await res.json();
    if (!isRecord(body) || body.ok !== true) {
      const error = isRecord(body) && typeof body.error === "string" ? body.error : "write-failed";
      // THE ONE THE PANE ALONE CAN REPORT. This write met the DEPLOYED rules, and their refusal
      // names nothing — "Missing or insufficient permissions" is the whole of it. Kept here because
      // the screen keeps it only until the next attempt, and it is the single most expensive line
      // an author can fail to carry back.
      remember({ kind: "write", cid, error });
      return { ok: false, error };
    }
    remember({ kind: "write", cid, error: null });
    const made = isRecord(body.written) ? body.written : null;
    // The TOKEN is required, not optional. Without it there is nothing undo would accept, and a row
    // in this list with no way to remove it is worse than no row: it says the pane can take the
    // record back. Falling through to the uncertain branch says the true thing instead.
    if (made !== null && typeof made.cid === "string" && typeof made.id === "string" && typeof made.token === "string" && made.token !== "") {
      const raw = made.mirror;
      const mirror = isRecord(raw) && typeof raw.cid === "string" && typeof raw.id === "string" ? { cid: raw.cid, id: raw.id } : undefined;
      written.value = [{ cid: made.cid, id: made.id, token: made.token, ...(mirror === undefined ? {} : { mirror }) }, ...written.value];
    } else {
      written.value = [{ cid, uncertain: true }, ...written.value];
    }
    // NOT awaited, and NOT `load()`. The bridge answers the page immediately after this resolves,
    // and `load()` blanks the payload on its way — which empties `pages`, changes the page being
    // drawn, and restarts the bridge. The answer would then be posted on a channel that had just
    // been closed, and the page would wait for ever on a request that had actually succeeded.
    void refresh();
    return { ok: true };
  } catch {
    remember({ kind: "write", cid, error: "the request failed after it was sent — a record may or may not be there" });
    // THE DANGEROUS CASE, and it is recorded rather than swallowed. The request threw, so this
    // cannot know whether the record was written — and if it was, dropping it here would leave a
    // real row in the app that nothing on this screen can name. The author cannot remove what they
    // cannot see, so the collection is remembered and said out loud.
    written.value = [{ cid, uncertain: true }, ...written.value];
    void refresh();
    return { ok: false, error: "write-failed" };
  }
}

/** Take them all back, through the app's own withdrawal shape where one is declared. */
async function clearWritten(): Promise<void> {
  if (clearing.value) return;
  clearing.value = true;
  try {
    // Only the ones with an id. An uncertain write has nothing to send, and guessing at one would
    // be a delete aimed at a document this pane never learned the name of.
    for (const record of written.value.filter(isNamed)) {
      // EACH ONE ON ITS OWN. `fetchWithTimeout` rejects on a timeout or a dropped connection, and
      // an uncaught rejection here would leave the loop — so one slow undo would silently decide
      // that none of the records after it get attempted, under a button that said it would take
      // them all back. They stay in the list either way; what must not happen is not trying.
      try {
        const res = await fetchWithTimeout(
          writeUrl("undo"),
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: record.token }) },
          SLOW_COMMAND_TIMEOUT_MS,
        );
        const body: unknown = await res.json();
        // Kept in the list when it could not be removed. A cleanup that quietly forgets what it
        // failed to delete is how a test booking outlives the session that made it.
        if (isRecord(body) && body.ok === true) written.value = written.value.filter((entry) => entry !== record);
      } catch {
        // Kept, for the same reason and more so: this does not know whether the delete landed.
      }
    }
  } finally {
    clearing.value = false;
    await load();
  }
}

// THE GENERATED FORM. An app that declares `public.submit` and publishes no page of its own is
// still a shared app a stranger meets — a survey, a signup, "count me in" — and until this existed
// the pane told its author the app "publishes a generated form ... drawing that form here is not
// wired up yet", which is a whole supported class of app that could not be previewed at all.
//
// WHAT IS FAITHFUL AND WHAT IS NOT, said plainly because the pane's first rule is that it must
// never look kinder than production. Every DECISION is the published projection's: which fields
// exist, their order, their labels, which are required, what type each is drawn as, and the record
// the submission becomes — all of it from `config/public`, reduced by the same `writableFields` the
// site calls. What is this pane's own is the MARKUP. The published site draws these inputs with its
// own styling, so this is not the pixels a visitor sees, and it is not sandboxed because there is
// no authored code here to sandbox — the form is derived, not written.
const formValues = ref<Record<string, Record<string, string>>>({});
const formSending = ref<string | null>(null);
const formError = ref<Record<string, string>>({});

const formInputs = computed<PreviewForm>(() => payload.value?.formInputs ?? {});

const valueOf = (cid: string, field: string): string => formValues.value[cid]?.[field] ?? "";

/** The typed value, narrowed HERE rather than asserted in the template — three element types
 *  reach this and none of them may be assumed. */
const onInput = (cid: string, field: string, event: Event): void => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    setValue(cid, field, target.value);
  }
};

const setValue = (cid: string, field: string, value: string): void => {
  formValues.value = { ...formValues.value, [cid]: { ...(formValues.value[cid] ?? {}), [field]: value } };
};

/** What the box is, from the schema's type — and DELIBERATELY the same short list as the published
 *  site's (`PublicSubmitForm.vue` in mulmoserver). Everything else is a text box.
 *
 *  Copied rather than improved on, because a richer control here would make the preview draw
 *  something a visitor never gets. A `checkbox` is the clearest case: it would post `"on"` whether
 *  ticked or cleared — the values on this wire are strings, since the rules compare stored values
 *  without coercing — so the author would test a record the real form cannot produce, and either
 *  see it accepted here and refused there, or the reverse. */
const inputType = (type: string): string => {
  if (type === "email") return "email";
  if (type === "number") return "number";
  if (type === "date") return "date";
  return "text";
};

async function sendForm(cid: string): Promise<void> {
  if (formSending.value !== null) return;
  formSending.value = cid;
  formError.value = { ...formError.value, [cid]: "" };
  try {
    // Straight to `send` with no confirmation panel. That panel exists because a SANDBOXED page
    // asked to write on somebody's behalf and the author had to see what it was asking for; here
    // the author typed the values themselves, and asking them to confirm their own typing would be
    // a second button in front of the one thing this screen is for.
    const result = await send(cid, formValues.value[cid] ?? {});
    if (!result.ok) {
      formError.value = { ...formError.value, [cid]: result.error ?? "write-failed" };
      return;
    }
    // Cleared only on success. A refusal leaves the boxes filled so the author can fix the one
    // field it named instead of typing the whole form again.
    formValues.value = { ...formValues.value, [cid]: {} };
  } finally {
    formSending.value = null;
  }
}

// TWO counters, not one.
//
// They shared one, and a refresh could then cancel a load: a submission resolving after the cell's
// directory changed called `refresh()`, which bumped the counter, so the `load()` already in flight
// failed its own guard — including the guard on `finally` — and the pane sat on "Computing what
// publishing would show…" until the directory changed again. A refresh is a background top-up and
// must never be able to abandon the read that decides what the pane IS.
let generation = 0;
let refreshGeneration = 0;

/** The same read as `load`, without the reset.
 *
 *  A write changes the records, so the frame has to be told — but the DOCUMENT has not changed, and
 *  tearing it down to say so would throw away the conversation it is having. Only the payload is
 *  swapped; the page, its nonce and its channel all stay. */
async function refresh(): Promise<void> {
  const mine = ++refreshGeneration;
  const load = generation;
  try {
    const res = await fetchWithTimeout(previewUrl());
    const body: unknown = await res.json();
    // Superseded by a newer refresh, or by a LOAD that started meanwhile — the second is the one
    // that matters: this answer is about a directory the pane may have left.
    if (mine !== refreshGeneration || load !== generation || !isRecord(body) || body.ok !== true) return;
    const next = asPayload(body.preview);
    if (next === null) return;
    payload.value = next;
    scopeLog(next.aid);
  } catch {
    // The records on screen are now older than the truth, and saying so would take the pane away
    // from an author in the middle of something. The next render says it.
  }
}

async function load(): Promise<void> {
  const mine = ++generation;
  loading.value = true;
  problems.value = [];
  payload.value = null;
  declared.value = false;
  try {
    const res = await fetchWithTimeout(previewUrl());
    const body: unknown = await res.json();
    if (mine !== generation) return;
    if (!isRecord(body)) {
      problems.value = ["The server answered with something this pane cannot read."];
      remember({ kind: "host", note: "the server answered with something this pane cannot read" });
      return;
    }
    declared.value = body.declared === true;
    if (body.declared !== true) return;
    if (body.ok !== true) {
      const listed = Array.isArray(body.problems) ? body.problems.filter((line): line is string => typeof line === "string") : [];
      problems.value = listed.length > 0 ? listed : ["The preview could not be computed."];
      remember({ kind: "host", note: `publishing this would be refused: ${problems.value.join(" ")}` });
      return;
    }
    payload.value = asPayload(body.preview);
    if (payload.value !== null) scopeLog(payload.value.aid);
    // The picker starts ON the page being drawn. Left null it renders blank while the frame below
    // it shows the first page, which reads as "no page selected" over a page that is right there.
    const first = payload.value?.pages[0];
    selectedId.value = first === undefined ? null : keyOf(first);
  } catch {
    if (mine !== generation) return;
    problems.value = ["Could not reach the server."];
    remember({ kind: "host", note: "the pane could not reach this host's own server" });
  } finally {
    if (mine === generation) loading.value = false;
  }
}

// THE BUTTON. One press, one block, and the reader is whoever is fixing the page — most often the
// LLM in the cell beside this one, which wrote it and has never run it.
//
// Written in the same words the headless run uses (`common/sharedAppViewVocabulary.ts`), so an
// author's paste and the agent's own `manageSharedApp` preview do not arrive as two accounts of one
// failure.
const { status: updateStatus } = useUpdateStatus();
const copied = ref(false);
let copiedTimer: ReturnType<typeof window.setTimeout> | undefined;

async function copyLog(): Promise<void> {
  const block = renderPreviewLog(
    {
      version: updateStatus.value?.version ?? "unknown",
      aid: payload.value?.aid ?? "unknown",
      cwd: props.cwd,
      page: page.value?.id ?? null,
      audience: page.value?.audience ?? null,
      publicOpen: payload.value?.publicOpen === true,
      fromLiveApp: payload.value?.fromLiveApp === true,
    },
    log,
  );
  try {
    await window.navigator.clipboard.writeText(block);
    copied.value = true;
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // A clipboard a browser refused is not something this pane can talk its way out of, and the
    // author has bigger problems on screen than a button that did not flash.
  }
}

onBeforeUnmount(() => window.clearTimeout(copiedTimer));

// The DIRECTORY is the other half of the app's identity, and it changes without a payload landing
// — a cell moved to a repository whose server cannot be reached keeps the old entries under the new
// directory's name, and the failure to reach it is the one line worth reading.
watch(
  () => props.cwd,
  () => {
    resetLog(null);
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-panel font-sans" role="region" aria-label="Shared app preview">
    <div v-if="loading" class="p-3 text-[12px] text-dim">Computing what publishing would show…</div>

    <!-- Not an error. Most directories are not shared apps, and this pane asks about whichever one
         the cell happens to be open in. -->
    <div v-else-if="!declared" class="p-3 text-[12px] text-dim">
      This directory declares no shared app. One lives in <code>app.json</code> beside the collections it publishes.
    </div>

    <div v-else-if="problems.length" class="p-3">
      <p class="mb-1.5 text-[12px] text-err-text">Publishing this would be refused:</p>
      <ul class="flex list-none flex-col gap-1 p-0">
        <li v-for="problem in problems" :key="problem" class="text-[11px] leading-[1.4] text-err-text">{{ problem }}</li>
      </ul>
    </div>

    <!-- Two states that put the same empty frame on screen and mean opposite things. Saying only
         "no pages" over an app that publishes a generated form tells the author their survey cannot
         be previewed BECAUSE there is nothing there, which is untrue and unactionable. -->
    <div v-else-if="pages.length === 0 && payload?.generatedForm" class="min-h-0 flex-1 overflow-auto p-3 font-sans">
      <p class="mb-2.5 text-[11px] leading-[1.4] text-dim">
        This app publishes a generated form rather than a page of its own. The fields, their order and what each one accepts come from
        <code>public.submit</code>, exactly as the published site reads them — the styling is this pane's.
      </p>
      <div v-for="(fields, cid) in formInputs" :key="cid" class="mb-3 rounded-[6px] border border-border p-2.5">
        <p class="mb-2 text-[11px] text-fg">
          <code>{{ cid }}</code>
        </p>
        <div v-for="field in fields" :key="field.name" class="mb-2 flex flex-col gap-1">
          <label class="text-[11px] text-dim" :for="`mt-form-${cid}-${field.name}`">
            {{ field.label }}<span v-if="field.required" class="text-err-text"> *</span>
          </label>
          <select
            v-if="field.values"
            :id="`mt-form-${cid}-${field.name}`"
            class="rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg"
            :value="valueOf(cid, field.name)"
            @change="onInput(cid, field.name, $event)"
          >
            <option value="">—</option>
            <option v-for="choice in field.values" :key="choice" :value="choice">{{ choice }}</option>
          </select>
          <textarea
            v-else-if="field.type === 'text' || field.type === 'markdown'"
            :id="`mt-form-${cid}-${field.name}`"
            rows="3"
            class="rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg"
            :value="valueOf(cid, field.name)"
            @input="onInput(cid, field.name, $event)"
          ></textarea>
          <input
            v-else
            :id="`mt-form-${cid}-${field.name}`"
            :type="inputType(field.type)"
            class="rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg"
            :value="valueOf(cid, field.name)"
            @input="onInput(cid, field.name, $event)"
          />
        </div>
        <button
          type="button"
          class="cursor-pointer rounded-[5px] border border-border bg-btn px-2 py-[3px] text-[11px] text-fg disabled:cursor-default disabled:opacity-60"
          :disabled="formSending !== null"
          @click="sendForm(cid)"
        >
          {{ formSending === cid ? "Sending…" : "Send it" }}
        </button>
        <!-- The server's words, not a rephrasing. It is the side that met the rules. -->
        <p v-if="formError[cid]" class="mt-1.5 text-[11px] leading-[1.4] text-err-text">{{ formError[cid] }}</p>
      </div>
    </div>
    <div v-else-if="pages.length === 0" class="p-3 text-[12px] text-dim">This app publishes no pages — only its schemas. There is nothing to draw.</div>

    <template v-else>
      <!-- `to` is only read while enabled; the body fallback keeps Vue from warning about a null
           target on the in-place path, where nothing is teleported at all. -->
      <Teleport :to="pickerTarget ?? 'body'" :disabled="!pickerTarget">
        <div :class="pickerTarget ? 'flex min-w-0 items-center gap-2' : 'flex flex-none flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5'">
          <!-- No visible label: on the host's toolbar the dropdown sits among controls that name
               themselves, and every option already reads "<id> — <audience>". The name a screen
               reader needs is still here. -->
          <select
            id="mt-preview-page"
            v-model="selectedId"
            aria-label="Which page of this app to draw"
            :class="[
              'rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg',
              // On a host toolbar the pane is 360-480px and shares the row with the pane's own
              // controls, so the select must be allowed to shrink below its longest option rather
              // than pushing them off the edge. Standing alone it keeps its intrinsic width.
              pickerTarget ? 'min-w-0 max-w-[16rem] shrink truncate' : '',
            ]"
          >
            <option v-for="candidate in pages" :key="keyOf(candidate)" :value="keyOf(candidate)">
              {{ candidate.id }} — {{ AUDIENCE_LABEL[candidate.audience] }}
            </option>
          </select>
        </div>
      </Teleport>

      <div class="min-h-0 flex-1">
        <!-- Byte for byte the document a visitor is served. No `allow-modals`, so `alert` /
             `confirm` / `prompt` are ignored here exactly as they are there; no
             `allow-same-origin`, so the frame gets an opaque origin and cannot reach this app's
             storage or credentials. Do not add either to "make the preview work" — a page that
             needs them is a page that is already broken in production. -->
        <iframe
          ref="frame"
          :key="nonce"
          :srcdoc="srcdoc"
          title="Shared app preview"
          sandbox="allow-scripts"
          csp="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'; connect-src 'none'"
          class="h-full w-full border-0 bg-input"
        />
      </div>

      <!-- OUTSIDE the frame, because a page cannot be trusted to describe its own success. What is
           said here is what the parent knows, not what the view drew. -->
      <div class="flex-none border-t border-border px-2.5 py-1.5" role="status" aria-live="polite">
        <!-- TWO halves, and they must not be merged. Computing the projection writes nothing, which
             is what makes the preview safe to open on a repository at any moment. Accepting a
             submission is the opposite: it is a real create, judged by the deployed rules, and it
             stays there. This said "nothing here is written" until writing shipped, which is the
             one thing this pane must never do — tell the author something kinder than the truth. -->
        <p class="text-[11px] text-dim">
          Records read as you, not as a visitor — this shows what DRAWS, not what a stranger would be allowed to see. Computing it writes nothing.
        </p>
        <p class="mt-1 text-[11px] text-amber">A submission you accept is a real record in the live app, and the rules do run on that.</p>
        <p v-if="payload && !payload.fromLiveApp" class="mt-1 text-[11px] text-dim">This app has never been published, so nothing was carried over.</p>
        <p v-if="payload && payload.unreadable.length" class="mt-1 text-[11px] text-amber">
          Could not read records for: {{ payload.unreadable.join(", ") }} — an empty page below may be a refusal rather than an empty collection.
        </p>
        <ul v-if="payload && payload.warnings.length" class="mt-1 flex list-none flex-col gap-1 p-0">
          <li v-for="warning in payload.warnings" :key="warning" class="text-[11px] leading-[1.4] text-amber">{{ warning }}</li>
        </ul>
      </div>

      <!-- THE CONFIRMATION, drawn by the parent, outside the frame.
           `event.source` proves which window sent the message; it does not prove a person asked
           for it, and the author's HTML can call submit the moment it loads. So the values are
           shown here, where the view cannot touch them — and the page's promise does not settle
           until one of these two buttons is pressed.
           Not optional, and not "for later": without it a submission is accepted and then nothing
           can resolve it, so the page waits forever on a request with no timeout. That is a button
           that does nothing — the exact failure this feature exists to catch, manufactured by the
           thing meant to catch it. -->
      <div v-if="cells.pending.value" class="flex-none border-t border-border px-2.5 py-2 font-sans">
        <p class="mb-1 text-[11px] text-fg">
          The page asks to write to <code>{{ cells.pending.value.cid }}</code>
        </p>
        <dl class="mb-2 flex list-none flex-col gap-0.5 p-0">
          <div v-for="[field, value] in Object.entries(cells.pending.value.values)" :key="field" class="flex gap-2 text-[11px]">
            <dt class="w-24 shrink-0 text-dim">{{ field }}</dt>
            <dd class="min-w-0 flex-1 break-words text-fg">{{ value }}</dd>
          </div>
        </dl>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg hover:border-accent disabled:cursor-default disabled:opacity-60"
            :disabled="cells.sending.value"
            @click="bridge.accept()"
          >
            Send it
          </button>
          <button
            type="button"
            class="cursor-pointer rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg hover:border-accent disabled:cursor-default disabled:opacity-60"
            :disabled="cells.sending.value"
            @click="bridge.decline()"
          >
            Cancel
          </button>
          <!-- Said at the button rather than only in the strip above: this is the moment the author
               is deciding, and what it costs is what they need to know here. -->
          <span class="text-[11px] text-dim">This writes a real record, as you.</span>
        </div>
      </div>
    </template>

    <!-- WHAT THIS SESSION WROTE, and the way to take it back.
           Kept by the pane rather than marked on the records: a public create is read with
           `hasOnly(createFields)`, so an extra key does not annotate the document — it refuses the
           whole write. In the database these are ordinary records, which is why forgetting them is
           the same as leaving them, and why the offer to remove them is here rather than later. -->
    <div v-if="written.length" class="flex-none border-t border-border px-2.5 py-1.5 font-sans">
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-amber">{{ written.length }} record{{ written.length === 1 ? "" : "s" }} written from this preview</span>
        <button
          type="button"
          class="cursor-pointer rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg hover:border-accent disabled:cursor-default disabled:opacity-60"
          :disabled="clearing"
          title="Remove them, restoring anything they were holding"
          @click="clearWritten"
        >
          {{ clearing ? "Removing…" : "Remove them" }}
        </button>
      </div>
      <ul class="mt-1 flex list-none flex-col gap-0.5 p-0">
        <li v-for="(record, index) in written" :key="index" class="text-[11px] leading-[1.4]" :class="isNamed(record) ? 'text-dim' : 'text-amber'">
          <template v-if="isNamed(record)">{{ record.cid }} / {{ record.id }}</template>
          <template v-else>{{ record.cid }} — the request failed after it was sent. A record may be there; this pane cannot name it.</template>
        </li>
      </ul>
      <!-- Said out loud because it is the failure mode: this list is the pane's, not the
             database's, so closing the pane loses the only record of which rows were tests. -->
      <p class="mt-1 text-[11px] text-dim">This list is not stored. Close the pane and these become ordinary records.</p>
    </div>

    <!-- WHAT HAPPENED, and the one press that carries it out.
         OUTSIDE every branch above on purpose: the moment an author most needs this is the one
         where the pane is showing a refusal instead of a page, and a button that appears only when
         things went well is a button for the case nobody needs it.
         Quiet at rest. The count is the ordinary state and says nothing alarming; a problem turns
         the same line amber, which is the whole of the alerting this does. -->
    <div v-if="declared || logSize > 0" class="flex flex-none flex-wrap items-center gap-2 border-t border-border px-2.5 py-1.5 font-sans">
      <span class="text-[11px]" :class="logProblems > 0 ? 'text-amber' : 'text-dim'">
        {{ logSize }} recorded<template v-if="logProblems > 0"> · {{ logProblems }} problem{{ logProblems === 1 ? "" : "s" }}</template>
      </span>
      <button
        type="button"
        class="cursor-pointer rounded-[5px] border border-border bg-input px-1.5 py-[3px] text-[11px] text-fg hover:border-accent"
        title="Everything the parent saw: the handshake, what the page submitted, what was refused and why, and what the frame reported about itself"
        @click="copyLog"
      >
        {{ copied ? "Copied" : "Copy what happened" }}
      </button>
      <!-- The refusals and the frame's own errors are the point, and neither is anywhere else: one
           is answered on a port nobody watches, the other dies at the frame boundary. -->
      <!-- PRECISE, because the page's own text is in there. This host records field names and
           never values — but an error the page raised is kept as the page wrote it, and a page is
           handed whole records, so `throw new Error(row.email)` puts that address in the block.
           Keeping it is the choice (it is the most actionable line the frame produces, and the
           reader is the author), so the promise has to be the narrow one that is true. -->
      <span class="text-[11px] text-dim">
        Paste it to whoever wrote the page. Nothing is stored. This records field names and never values — but text the PAGE wrote is kept as it wrote it.
      </span>
    </div>
  </div>
</template>
