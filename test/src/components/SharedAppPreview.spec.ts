// The preview frame's contract with the document it renders.
//
// What is pinned here is that the preview is NOT a kinder version of production. Every one of
// these assertions is something that would make a broken page look fine on the author's machine
// and break in a stranger's browser, which is the exact failure the feature exists to prevent:
//
//   `allow-modals` absent, so `alert` / `confirm` / `prompt` are ignored here as they are there;
//   `allow-same-origin` absent, so the frame has an opaque origin;
//   the CSP present, so nothing the page loads reaches a third party;
//   the bootstrap present, so the page talks to a parent rather than to nothing;
//   a FRESH nonce per rendered document, so a page that navigated cannot go on answering.
//
// Imported at module scope, not inside a test: the component's module graph is billed to whichever
// test first reaches it, and that has made a file's first test look 100x slower than its siblings.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import SharedAppPreview from "../../../src/components/SharedAppPreview.vue";
import { isRecord } from "../../../common/isRecord.js";
import { until } from "../../helpers/hopUntil";
import { MEMBER_CAPABILITY } from "../../support/viewCapability";

const PAGE = "<h1>Book</h1>";

const FORM_FIELD = { name: "name", label: "お名前", required: true, type: "string" };

/** And one as it resolves for a PUBLIC page, which carries a viewer too: the rules let whoever
 *  submitted a row move it and take it away, so `selfTransitions` and `selfDelete` resolve to
 *  capabilities on the visitor's own rows. `me` is null there and only there — see the note on the
 *  test that pins it. */
const PUBLIC_VIEWER = { me: null, can: { bookings: { ...MEMBER_CAPABILITY, transitionAny: false, transitionOwn: true, withdrawFrom: ["booked"] } } };

/** An app whose only page is written for the front desk, so it is the one selected on mount. */
const memberPayload = () =>
  payload({
    pages: [{ id: "desk", html: PAGE, audience: "member", viewer: { me: "owner@gym.jp", can: { bookings: MEMBER_CAPABILITY } } }],
    datasets: { "member:desk": { bookings: [] } },
  });

const payload = (over: Record<string, unknown> = {}) => ({
  declared: true,
  ok: true,
  preview: {
    aid: "aid-1",
    submit: { bookings: { createFields: ["slot", "requesterName"] } },
    pages: [{ id: "public", html: PAGE, audience: "public", viewer: PUBLIC_VIEWER }],
    publicFace: "open",
    fromLiveApp: false,
    generatedForm: false,
    datasets: { "public:public": { bookings: [] } },
    unreadable: [],
    warnings: [],
    ...over,
  },
});

const answering = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

/** A fetch that answers the projection route and the write routes separately, and records the
 *  writes it was asked to make. */
const answeringWrites = (write: unknown, preview: unknown = payload()) => {
  const posted: { url: string; body: unknown }[] = [];
  const fetcher = vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
    if (url.includes("/preview/")) {
      posted.push({ url, body: init?.body === undefined ? null : JSON.parse(init.body) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(write) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(preview) });
  });
  return { fetcher, posted };
};

beforeEach(() => {
  vi.stubGlobal("fetch", answering(payload()));
  clipboard = "";
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: (text: string) => {
        clipboard = text;
        return Promise.resolve();
      },
    },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Do the handshake and return the far end of the private channel. */
const connect = async (wrapper: VueWrapper) => {
  const frame = wrapper.find("iframe").element as HTMLIFrameElement;
  const srcdoc = frame.getAttribute("srcdoc") ?? "";
  const nonce = /const nonce = "([^"]+)"/.exec(srcdoc)?.[1] ?? "";

  let far: MessagePort | null = null;
  const contentWindow = {
    postMessage: (_message: unknown, _origin: string, ports?: MessagePort[]) => {
      far = ports?.[0] ?? null;
    },
  };
  vi.spyOn(frame, "contentWindow", "get").mockReturnValue(contentWindow as unknown as Window);

  const ready = new MessageEvent("message", { data: { type: "mc-public-view:ready", nonce } });
  Object.defineProperty(ready, "source", { value: contentWindow });
  window.dispatchEvent(ready);
  await flushPromises();

  const port = far as MessagePort | null;
  if (port === null) throw new Error("the parent never handed over a channel");
  const answers: Record<string, unknown>[] = [];
  port.onmessage = (event: MessageEvent) => answers.push(event.data as Record<string, unknown>);
  port.start();
  // The name only the injected document knows, echoed on the port it was handed.
  port.postMessage({ nonce });
  await flushPromises();
  // The nonce and the window are handed back for the diagnostics tests: a NOTICE travels on the
  // window rather than the port, and proving it is heard means being able to speak as the document
  // the parent injected.
  return { port, answers, nonce, contentWindow };
};

/** The clipboard, as this pane writes to it. */
let clipboard = "";

/** Say something as the document in the frame, on the WINDOW.
 *
 *  A notice goes this way rather than on the private channel because the ones that matter most
 *  happen before the handshake — a page whose script throws while it is being parsed never calls
 *  `ready()` — so this helper deliberately does not require a connection. */
const speakFromFrame = async (wrapper: VueWrapper, data: Record<string, unknown>, source?: unknown): Promise<void> => {
  const frame = wrapper.find("iframe").element as HTMLIFrameElement;
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source ?? frame.contentWindow });
  window.dispatchEvent(event);
  await flushPromises();
};

const nonceOf = (wrapper: VueWrapper): string => /const nonce = "([^"]+)"/.exec(wrapper.find("iframe").attributes("srcdoc") ?? "")?.[1] ?? "";

// Found by its title rather than its label: the label becomes "Copied" for a moment after a press,
// and a helper that looked for the label would quietly stop finding it on the second call.
const copyButton = (wrapper: VueWrapper) =>
  wrapper.findAll("button").find((candidate) => (candidate.attributes("title") ?? "").startsWith("Everything the parent saw"));

const copyBlock = async (wrapper: VueWrapper): Promise<string> => {
  const button = copyButton(wrapper);
  if (button === undefined) throw new Error("the pane offers no way to copy what happened");
  await button.trigger("click");
  await flushPromises();
  return clipboard;
};

/** The pane's own text, once it says what the test is about to assert. */
const untilText = async (wrapper: VueWrapper, text: string): Promise<void> =>
  until(() => wrapper.text().includes(text), `the pane to show ${JSON.stringify(text)}`);

/** What the pane put on the clipboard, once it says what the test is about to assert. Re-read on
 *  each hop: the block is built when the button is pressed, so waiting on one copy of it would
 *  wait forever.
 *
 *  A missing button counts as "not yet" rather than as a failure — it disappears while the pane
 *  loads a different app, which is precisely a moment a test may be waiting through. The timeout
 *  still names what never arrived, so nothing is hidden by this. */
const untilBlock = async (wrapper: VueWrapper, text: string): Promise<string> => {
  // The button's absence is ASKED about rather than caught: it disappears while the pane loads a
  // different app, which is a moment a test waits through — but a catch-all here would also
  // swallow a genuine failure inside `copyBlock` (a broken clipboard stub, say) for 200 hops and
  // then report it as the wrong thing.
  // The block that SATISFIED the condition is the one handed back. Copying a second time presses
  // the control again and awaits another flush, so a re-render between the two could remove the
  // control or replace the diagnostics — and the caller would be asserting against a block the
  // wait never approved (CodeRabbit on #1798).
  let found = "";
  const says = async (): Promise<boolean> => {
    if (copyButton(wrapper) === undefined) return false;
    found = await copyBlock(wrapper);
    return found.includes(text);
  };
  await until(says, `the record to mention ${JSON.stringify(text)}`);
  return found;
};

// #1802 reached this same conclusion independently and from the other direction: its member-intent
// answer crosses the HTTP boundary twice before the page is told, so a fixed turn count passed on
// macOS and Linux and failed on WINDOWS in CI. It added a `settleUntil(arrived, turns = 20)`; this
// branch's `until` is that with a name for what never came and no turn budget in the caller, so the
// merge keeps one helper rather than two.

/** Press a button by its label, once it exists.
 *
 *  `findAll("button").filter(…)[0]?.trigger("click")` is a SILENT no-op when the control has not
 *  rendered yet: the test goes on to assert about a click that never happened, and reports
 *  whatever it finds instead of saying the button was missing (Codex on #1798). Waiting for the
 *  control — and refusing to continue without it — turns that into a named failure. */
const press = async (wrapper: VueWrapper, label: string): Promise<void> => {
  const labelled = () => wrapper.findAll("button").filter((button) => button.text() === label);
  await until(() => labelled().length > 0, `a ${JSON.stringify(label)} button`);
  const button = labelled()[0];
  if (button === undefined) throw new Error(`the ${JSON.stringify(label)} button went away before it could be pressed`);
  await button.trigger("click");
};

/** "at least N undo requests have reached the server", as a predicate — named here so the call site
 *  does not nest another callback inside an already-nested `describe`. */
const undoRequests = (posted: { url: string }[], count: number) => () => posted.filter((entry) => entry.url.includes("/preview/undo")).length >= count;

/** A predicate the tests share, kept out of the test bodies so the call site does not nest another
 *  callback inside an already-nested `describe`. */
const answered = (answers: Record<string, unknown>[], requestId: string) => () => answers.some((answer) => answer.requestId === requestId);

/** The answer a test is about to read, once it has arrived. */
const answerFor = async (answers: Record<string, unknown>[], match: (answer: Record<string, unknown>) => boolean, what: string) => {
  await until(() => answers.some(match), what);
  return answers.find(match);
};

const mountPreview = async () => {
  const wrapper = mount(SharedAppPreview, { props: { cwd: "/repo" } });
  await flushPromises();
  return wrapper;
};

describe("SharedAppPreview", () => {
  // The page picker is the HOST's chrome once a host offers a place for it: the collections pane
  // has a toolbar of its own, and a strip directly under it was two toolbars saying different
  // halves of one thing. Without a target it stays where it was, which is what a standalone mount
  // (and every other test in this file) gets.
  it("teleports the page picker into the host's toolbar when it is given one", async () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    const wrapper = mount(SharedAppPreview, { props: { cwd: "/repo", pickerTarget: slot } });
    await flushPromises();

    expect(slot.querySelector("#mt-preview-page")).not.toBeNull();
    expect(wrapper.element.querySelector("#mt-preview-page")).toBeNull();
    wrapper.unmount();
    // And it leaves nothing of its own behind in the host's toolbar.
    expect(slot.querySelector("#mt-preview-page")).toBeNull();
    slot.remove();
  });

  it("keeps the page picker in place when no target is given", async () => {
    const wrapper = await mountPreview();
    expect(wrapper.element.querySelector("#mt-preview-page")).not.toBeNull();
  });

  // WHAT HAPPENED, carried out of the pane in one press.
  //
  // Every fact below already passed through this component and was then thrown away, and each was
  // invisible in its own way: a refusal is answered on a port nobody watches, an error inside the
  // frame dies at the frame boundary, and the deployed rules' refusal is overwritten by the next
  // attempt. What the author could carry back to the LLM that wrote the page was "it seems stuck".
  it("keeps the refusal the page cannot see, and hands it over on one press", async () => {
    const wrapper = await mountPreview();
    const { port } = await connect(wrapper);
    // A field the declaration does not carry. The rules would refuse the whole write with a
    // permission error naming nothing; the parent refuses it here and names it — to the page's
    // promise, which the page usually does not await, and to nowhere else.
    port.postMessage({ type: "mc-public-view:submit", requestId: "r1", cid: "bookings", values: { nope: "x" } });
    const block = await untilBlock(wrapper, "REFUSED by the parent");
    expect(block).toContain("REFUSED by the parent");
    expect(block).toContain("`createFields`");
  });

  it("hears the frame report itself BEFORE the handshake, which is the page nobody can diagnose", async () => {
    const wrapper = await mountPreview();
    // No `ready` and there never will be: this is the page whose script threw while the document
    // was being parsed. It sits on its loading state with the reason locked inside the frame.
    await speakFromFrame(wrapper, { type: "mc-public-view:notice", nonce: nonceOf(wrapper), code: "error", detail: "slot is not defined (line 12)" });

    const block = await copyBlock(wrapper);
    expect(block).toContain("the frame reported 'error'");
    expect(block).toContain("slot is not defined (line 12)");
    // And it is marked as the page's words. The reader is often a model being asked what went
    // wrong, and a string the page chose must not arrive as something this host is saying.
    expect(block).toContain("page text:");
  });

  it("will not take a report from a window that cannot name the document we injected", async () => {
    const wrapper = await mountPreview();
    await speakFromFrame(wrapper, { type: "mc-public-view:notice", nonce: "guessed", code: "error", detail: "a lie" });
    expect(await copyBlock(wrapper)).not.toContain("a lie");
  });

  it("records what was submitted by NAME, and never what was typed into it", async () => {
    // The block is built to be pasted somewhere else, and a shared app's records hold other
    // people's answers. Field names and collection ids are the diagnosis; the values are not.
    const wrapper = await mountPreview();
    const { port } = await connect(wrapper);
    port.postMessage({ type: "mc-public-view:submit", requestId: "r1", cid: "bookings", values: { slot: "SECRET-VALUE" } });
    const block = await untilBlock(wrapper, "the page submitted to 'bookings' carrying slot");
    expect(block).toContain("the page submitted to 'bookings' carrying slot");
    expect(block).not.toContain("SECRET-VALUE");
  });

  it("counts a problem where there is one, and stays quiet where there is not", async () => {
    const wrapper = await mountPreview();
    await connect(wrapper);
    // A handshake and a state delivery are not problems, and a pane that called them problems
    // would train its author to ignore the count.
    expect(wrapper.text()).toContain("recorded");
    expect(wrapper.text()).not.toContain("problem");

    await speakFromFrame(wrapper, { type: "mc-public-view:notice", nonce: nonceOf(wrapper), code: "modal-ignored", detail: "confirm" });
    expect(wrapper.text()).toContain("1 problem");
  });

  it("does not report one app's events under another app's name", async () => {
    // The block names ONE app and ONE directory. Entries carried across a directory change would be
    // reported as this app's — an author debugging app B handed a block that says B and describes
    // A — and since the block is built to be pasted elsewhere, that is also one app's diagnostics
    // leaving inside another's.
    const wrapper = await mountPreview();
    await speakFromFrame(wrapper, { type: "mc-public-view:notice", nonce: nonceOf(wrapper), code: "error", detail: "from the first app" });
    expect(await copyBlock(wrapper)).toContain("from the first app");

    vi.stubGlobal("fetch", answering(payload({ aid: "aid-2" })));
    await wrapper.setProps({ cwd: "/another-repo" });
    // Waited on the SECOND app arriving, not on a number of turns: "the entry is gone" is also true
    // before the switch has happened at all, so a budget here can pass for the wrong reason. The
    // block names the aid it is reporting, which is exactly the anchor this needs.
    const block = await untilBlock(wrapper, "aid-2");
    expect(block).not.toContain("from the first app");
  });

  it("keeps what was recorded when the same app is merely re-read", async () => {
    // Every accepted write re-reads the projection, and so does Remove them. Emptying the log there
    // would lose it at the exact moment an author had finished reproducing something.
    const wrapper = await mountPreview();
    await speakFromFrame(wrapper, { type: "mc-public-view:notice", nonce: nonceOf(wrapper), code: "error", detail: "still worth reading" });
    await wrapper.setProps({ cwd: "/repo" });
    expect(await untilBlock(wrapper, "still worth reading")).toContain("still worth reading");
  });

  it("names the collection a cancelled confirmation was for", async () => {
    // `decline()` settles the confirmation and THEN answers, so the cell is already null by the
    // time the answer goes past — read there, every cancellation named an empty collection.
    const wrapper = await mountPreview();
    const { port } = await connect(wrapper);
    port.postMessage({ type: "mc-public-view:submit", requestId: "r1", cid: "bookings", values: { slot: "a" } });
    await press(wrapper, "Cancel");
    expect(await untilBlock(wrapper, "the confirmation for 'bookings' was declined")).toContain("the confirmation for 'bookings' was declined");
  });

  it("can still be copied when the pane never got a declaration to show", async () => {
    // The unreachable server and the unreadable answer are exactly the cases the host events were
    // added for, and both leave `declared` false — a control hidden behind it is hidden precisely
    // when the diagnostic exists.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")));
    const wrapper = await mountPreview();
    expect(await untilBlock(wrapper, "could not reach this host's own server")).toContain("could not reach this host's own server");
  });

  // WHO the author is to a member page, and what they may change.
  //
  // The pane had one parent — the PUBLIC one — whose state message has no `viewer` key at all. The
  // injected runtime reads `data.viewer || {}`, so every roster page ever previewed here was handed
  // an empty object and drew none of its buttons. That is indistinguishable from an author who got
  // the capability names wrong, and it was diagnosed as exactly that before this was fixed.
  it("hands a member page the capabilities the live page would get", async () => {
    vi.stubGlobal("fetch", answering(memberPayload()));
    const wrapper = await mountPreview();
    const { answers } = await connect(wrapper);
    // A port's delivery is a MACROTASK, so `flushPromises` alone does not guarantee it has
    // arrived. It happened to on Linux and macOS and did not on Windows — a test that passes by
    // being fast enough is a test that reports a working feature as broken on somebody else's
    // machine.
    const state = await answerFor(answers, (message) => message.type === "mc-public-view:state", "the page's state");
    // `mine` rides in the same envelope now — the two used to belong to different parents, so a
    // page could have one or the other and a member page always had neither.
    expect(state?.viewer).toEqual({ me: "owner@gym.jp", can: { bookings: MEMBER_CAPABILITY }, mine: {} });
    wrapper.unmount();
  });

  // A PUBLIC PAGE GETS ONE TOO, and that is the correction. It was withheld because "a public page
  // has no reader and no roles" — but the rules disagree: `ownRow` asks for `authed()` and nothing
  // else, and `selfTransitions` / `selfDelete` are declared inside `public.submit`. So the visitor
  // who submitted a row may move it, and a page with no `viewer` draws no button for that.
  //
  // What it carries here is `mine` and nothing else: this payload resolves no capabilities, and an
  // absent `can` is "this host does not say" rather than "you may do nothing".
  it("tells a public page what it has already submitted", async () => {
    const wrapper = await mountPreview();
    const { answers } = await connect(wrapper);
    // A port's delivery is a MACROTASK, so `flushPromises` alone does not guarantee it has
    // arrived. It happened to on Linux and macOS and did not on Windows — a test that passes by
    // being fast enough is a test that reports a working feature as broken on somebody else's
    // machine.
    const state = await answerFor(answers, (message) => message.type === "mc-public-view:state", "the page's state");
    expect(state?.viewer).toEqual({ ...PUBLIC_VIEWER, mine: {} });
    wrapper.unmount();
  });

  // The pane's own chrome, and the third place the audience was still deciding something it no
  // longer knows. A move has neither brake a submission has — no confirmation, nothing to undo it
  // with — so the warning matters most exactly where it was withheld.
  it("warns that a move cannot be taken back on a PUBLIC page too, and only where there is one to make", async () => {
    const wrapper = await mountPreview();
    expect(wrapper.text()).toContain("There is no confirmation and no undo");
    wrapper.unmount();

    // A page whose ONLY control is the writer's delete is warned too — the sharpest case there is,
    // since a delete takes the row away and `withdrawFrom` (the submitter's half) is empty on a
    // staff page. Asking only the halves that existed before `writerDelete` left this page silent
    // about the one control that empties a collection.
    const deletes = { me: "owner@gym.jp", can: { names: { ...MEMBER_CAPABILITY, cid: "names", transitionAny: false, withdrawAny: true } } };
    vi.stubGlobal("fetch", answering(payload({ pages: [{ id: "desk", html: PAGE, audience: "member", viewer: deletes }] })));
    const deleting = await mountPreview();
    expect(deleting.text()).toContain("There is no confirmation and no undo");
    deleting.unmount();

    // And it asks the CAPABILITIES rather than the audience: a page that can move nothing is not
    // warned about a control it does not have.
    vi.stubGlobal("fetch", answering(payload({ pages: [{ id: "public", html: PAGE, audience: "public", viewer: { me: null, can: {} } }] })));
    const quiet = await mountPreview();
    expect(quiet.text()).not.toContain("There is no confirmation and no undo");
    quiet.unmount();
  });

  // The same account for a PUBLIC page, and it was not given one: the warning asked for a member
  // page, because a public one was assumed to need no capabilities. It needs them for its own
  // rows — so a public page arriving without them draws no cancel button either, and said nothing
  // about why.
  it("says so when a PUBLIC page arrives with no capabilities either", async () => {
    vi.stubGlobal("fetch", answering(payload({ pages: [{ id: "public", html: PAGE, audience: "public" }] })));
    const wrapper = await mountPreview();
    const block = await copyBlock(wrapper);
    expect(block).toContain("arrived with no capabilities");
    expect(block).toContain("1 problem");
    wrapper.unmount();
  });

  // The member parent PERFORMS. It answered `read-only` until 2026-08-18, which read as a fault in
  // the page: a desk drew its buttons and every one of them failed, so an author could see that a
  // control was wired and never that it worked.
  //
  // ONE end-to-end test, because what it proves is the WIRING: the port is connected to the sender
  // and the sender's answer reaches the page. What a refusal does, and what is not sent at all, are
  // the sender's own and are pinned in `test/src/utils/sharedAppPreviewIntent.spec.ts` — where they
  // cost no frame.
  //
  // What is pinned is the ask reaching the route AND CARRYING ITS PAGE. The page is what decides
  // which tier's projection judges the move and which records it may name — without it a
  // participant's page could reach the front desk's transitions by naming the collection they live
  // in, and the server would have nothing to notice it with.
  it("performs a member page's intent, naming the page it was asked from", async () => {
    const { fetcher, posted } = answeringWrites({ ok: true, mailed: false }, memberPayload());
    vi.stubGlobal("fetch", fetcher);
    const wrapper = await mountPreview();
    const { port, answers } = await connect(wrapper);
    port.postMessage({ type: "mc-public-view:intent", requestId: "r1", kind: "transition", cid: "bookings", itemId: "b1", to: "approved" });
    // main's behaviour (#1802): the member parent PERFORMS the intent now rather than refusing it.
    // Kept whole; only the wait is this branch's — `answerFor` names what never arrived, where
    // `settleUntil` reports the absence as whatever the next assertion happens to find.
    const result = await answerFor(
      answers,
      (message) => message.type === "mc-public-view:submitResult" && message.requestId === "r1",
      "an answer to the member page's intent",
    );
    const sent = posted.find((call) => call.url.includes("/preview/intent"));
    expect(sent?.body).toEqual({ page: { id: "desk", audience: "member" }, kind: "transition", cid: "bookings", itemId: "b1", to: "approved" });
    expect(result?.ok).toBe(true);
    wrapper.unmount();
  });

  // A member page that throws while its script is being parsed never reaches `ready()`. It sits on
  // its loading state with the reason sealed inside the frame, and it is the page an author cannot
  // otherwise diagnose — so the pane must hear it through the member parent too, not only the
  // public one.
  it("hears a member page report itself before the handshake", async () => {
    vi.stubGlobal("fetch", answering(memberPayload()));
    const wrapper = await mountPreview();
    await speakFromFrame(wrapper, { type: "mc-public-view:notice", nonce: nonceOf(wrapper), code: "error", detail: "boom" });
    expect(await copyBlock(wrapper)).toContain("the page raised an error nothing caught");
    wrapper.unmount();
  });

  // A member page that arrives WITHOUT capabilities. The pane must not hand it an invented empty
  // viewer — that is the no-controls page this whole change removes — and it must not fall back to
  // the public parent quietly either, which puts the author in front of the same blank page with
  // nothing to read. The cause is not in their page: it is a host too old to resolve them, or an
  // answer in a shape this pane could not narrow.
  it("says so when a member page arrives with no capabilities, rather than drawing a blank one", async () => {
    vi.stubGlobal("fetch", answering(payload({ pages: [{ id: "desk", html: PAGE, audience: "member" }], datasets: { "member:desk": { bookings: [] } } })));
    const wrapper = await mountPreview();
    const block = await copyBlock(wrapper);
    expect(block).toContain("arrived with no capabilities");
    expect(block).toContain("The page is not at fault");
    // And it is COUNTED, so the pane's own indicator lights: a line nobody is pointed at is a line
    // nobody reads.
    expect(block).toContain("1 problem");
    wrapper.unmount();
  });

  // Whichever parent answered it. The handshake is the line above which nothing else can be
  // trusted, and the pane watches ONE cell for it — wired to the public parent alone, a member page
  // that readied perfectly showed no handshake at all.
  it("logs the handshake for a member page too", async () => {
    vi.stubGlobal("fetch", answering(memberPayload()));
    const wrapper = await mountPreview();
    await connect(wrapper);
    expect(await untilBlock(wrapper, "the page answered the handshake")).toContain("the page answered the handshake");
    wrapper.unmount();
  });

  it("renders the page in a frame no looser than the published one", async () => {
    const wrapper = await mountPreview();
    const frame = wrapper.find("iframe");

    expect(frame.exists()).toBe(true);
    // The whole point. `allow-modals` here would make a page whose `prompt()` the real sandbox
    // ignores appear to work — which is finding #1 from the diagnostics plan, manufactured by the
    // very thing meant to catch it.
    expect(frame.attributes("sandbox")).toBe("allow-scripts");
    expect(frame.attributes("csp")).toContain("connect-src 'none'");
  });

  it("serves the author's HTML with the parent's bootstrap above it", async () => {
    const wrapper = await mountPreview();
    const srcdoc = wrapper.find("iframe").attributes("srcdoc") ?? "";

    expect(srcdoc).toContain(PAGE);
    // The contract's name. A page written against the HOST's `__MC_VIEW` reads `undefined` and
    // draws nothing, and publish refuses one — so the preview must not quietly answer both.
    expect(srcdoc).toContain("__MC_APP_VIEW");
    expect(srcdoc).toContain("Content-Security-Policy");
  });

  it("gives each rendered document its own name", async () => {
    const first = (await mountPreview()).find("iframe").attributes("srcdoc") ?? "";
    const second = (await mountPreview()).find("iframe").attributes("srcdoc") ?? "";

    // Per render, not per component: reusing a nonce would let the previous document — which may
    // be the one that navigated away — go on being answered.
    expect(first).not.toBe(second);
  });

  it("says a directory with no app is not an app, and draws no frame", async () => {
    vi.stubGlobal("fetch", answering({ declared: false }));

    const wrapper = await mountPreview();

    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.text()).toContain("declares no shared app");
  });

  it("puts the refusals in front of the author rather than an empty frame", async () => {
    vi.stubGlobal("fetch", answering({ declared: true, ok: false, problems: ["public.view.path names no file"] }));

    const wrapper = await mountPreview();

    expect(wrapper.text()).toContain("public.view.path names no file");
    expect(wrapper.find("iframe").exists()).toBe(false);
  });

  it("distinguishes an empty collection from one it could not read", async () => {
    vi.stubGlobal("fetch", answering(payload({ unreadable: ["bookings"] })));

    const wrapper = await mountPreview();

    // Identical pixels, opposite meanings: a page drawing nothing because there are no bookings,
    // and one drawing nothing because the read was refused.
    expect(wrapper.text()).toContain("Could not read records for: bookings");
  });

  it("says out loud that this is not what a stranger would be allowed to see", async () => {
    const wrapper = await mountPreview();

    // The one claim a preview must never let anyone make. What it proves is that the page DRAWS —
    // the records reached it through the AUTHOR's credentials, so a page drawing a collection no
    // visitor may read looks identical here to one that is correctly open.
    expect(wrapper.text()).toContain("not as a visitor");
    expect(wrapper.text()).toContain("what a stranger would be allowed to see");
  });

  it("draws nothing but a note for an app that publishes only schemas", async () => {
    vi.stubGlobal("fetch", answering(payload({ pages: [] })));

    const wrapper = await mountPreview();

    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.text()).toContain("publishes no pages");
  });

  it("does not report a generated-form app as having nothing to draw", async () => {
    vi.stubGlobal("fetch", answering(payload({ pages: [], generatedForm: true })));

    const wrapper = await mountPreview();

    // Same empty frame, opposite meanings. "There is nothing here" over a survey that publishes
    // perfectly well sends the author looking for a bug that is not there.
    expect(wrapper.text()).toContain("generated form");
    expect(wrapper.text()).not.toContain("publishes no pages");
  });

  it("draws the generated form from the published inputs, and sends what was typed", async () => {
    const { fetcher, posted } = answeringWrites(
      { ok: true, written: { cid: "signups", id: "uid-1", token: "t-signup" } },
      payload({
        pages: [],
        generatedForm: true,
        submit: { signups: { createFields: ["name", "plan"] } },
        formInputs: {
          signups: [
            { name: "name", label: "お名前", required: true, type: "string" },
            { name: "plan", label: "Plan", required: false, type: "enum", values: ["A", "B"] },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    const wrapper = await mountPreview();

    // The LABELS the projection published, not the field names — a visitor is asked "お名前", and an
    // author checking their declaration has to see the same thing.
    expect(wrapper.text()).toContain("お名前");
    // An `enum` is a select with its choices, because that is what the published site draws. A text
    // box here would let the author submit a value the real form cannot produce.
    const choices = wrapper.findAll("select option").map((option) => option.text());
    expect(choices).toEqual(["—", "A", "B"]);

    await wrapper.find("input").setValue("中島");
    await wrapper.find("select").setValue("B");
    await press(wrapper, "Send it");
    await until(() => posted.length > 0, "the write to reach the server");

    expect(posted[0]?.url).toContain("/preview/submit");
    expect(posted[0]?.body).toEqual({ cid: "signups", values: { name: "中島", plan: "B" } });
  });

  it("does not tell the author that nothing is written", async () => {
    const wrapper = await mountPreview();

    // The copy predates the write path and said "nothing here is written" after submissions started
    // creating real records. A preview that describes itself more kindly than it behaves is the one
    // failure this whole feature exists to prevent, turned on its own screen.
    expect(wrapper.text()).not.toContain("Nothing here is written");
    expect(wrapper.text()).toContain("real record in the live app");
    expect(wrapper.text()).toContain("Computing it writes nothing");
  });

  it("draws the same input kinds the published site does, and no richer ones", async () => {
    vi.stubGlobal(
      "fetch",
      answering(
        payload({
          pages: [],
          generatedForm: true,
          submit: { signups: { createFields: ["agreed", "when", "count"] } },
          formInputs: {
            signups: [
              { name: "agreed", label: "Agreed", required: false, type: "boolean" },
              { name: "when", label: "When", required: false, type: "datetime" },
              { name: "count", label: "Count", required: false, type: "number" },
            ],
          },
        }),
      ),
    );

    const wrapper = await mountPreview();

    // `PublicSubmitForm.vue` in mulmoserver knows email / number / date and draws everything else
    // as text. A checkbox here would post "on" whether ticked or cleared — this wire carries
    // strings — so the author would be testing a record the real form cannot produce.
    expect(wrapper.findAll("input").map((input) => input.attributes("type"))).toEqual(["text", "text", "number"]);
  });

  it("offers to take back what a generated form wrote", async () => {
    // The records strip used to live inside the pages branch, so an app with only a form could
    // write real rows and have nowhere to take them back from — the list is the ONLY place they
    // are known to be tests.
    const { fetcher } = answeringWrites(
      { ok: true, written: { cid: "signups", id: "uid-1", token: "t-signup" } },
      payload({ pages: [], generatedForm: true, submit: { signups: { createFields: ["name"] } }, formInputs: { signups: [FORM_FIELD] } }),
    );
    vi.stubGlobal("fetch", fetcher);

    const wrapper = await mountPreview();
    await wrapper.find("input").setValue("中島");
    await press(wrapper, "Send it");
    await untilText(wrapper, "1 record written from this preview");

    expect(wrapper.text()).toContain("1 record written from this preview");
    expect(wrapper.text()).toContain("signups / uid-1");
  });

  it("keeps the typed values when the server refuses, and says why", async () => {
    const { fetcher } = answeringWrites(
      { ok: false, error: "missing: お名前" },
      payload({ pages: [], generatedForm: true, submit: { signups: { createFields: ["name"] } }, formInputs: { signups: [FORM_FIELD] } }),
    );
    vi.stubGlobal("fetch", fetcher);

    const wrapper = await mountPreview();
    await wrapper.find("input").setValue("中島");
    await press(wrapper, "Send it");
    await untilText(wrapper, "missing: お名前");

    // The server's words. And the box still holds what was typed: a refusal names one field, and
    // clearing the form would make the author retype the rest to find out.
    expect(wrapper.text()).toContain("missing: お名前");
    expect(wrapper.find("input").element.value).toBe("中島");
  });

  it("offers every tier's pages, not only the public one", async () => {
    vi.stubGlobal(
      "fetch",
      answering(
        payload({
          pages: [
            { id: "public", html: PAGE, audience: "public" },
            { id: "desk", html: "<p>desk</p>", audience: "member" },
            { id: "mine", html: "<p>mine</p>", audience: "roster" },
          ],
        }),
      ),
    );

    const wrapper = await mountPreview();
    const options = wrapper.findAll("option").map((option) => option.text());

    // Three separate documents with three separate rules — reading one of them as "the app" is how
    // a page written for the front desk gets published to the world.
    expect(options.some((text) => text.includes("public"))).toBe(true);
    expect(options.some((text) => text.includes("desk"))).toBe(true);
    expect(options.some((text) => text.includes("mine"))).toBe(true);
  });

  it("starts with the picker on the page it is drawing", async () => {
    const wrapper = await mountPreview();

    // A blank picker over a page that is right there reads as "nothing selected", and the first
    // thing the author does is click the thing that was already showing.
    expect((wrapper.find("select").element as HTMLSelectElement).value).toBe("public:public");
  });

  // The parent judges a submission against the app's declaration BEFORE the write path is reached.
  // Getting the declaration wrong here does not weaken the check — it refuses EVERYTHING, and it
  // refuses with a code that names the author's own repository. That shipped once (2026-08-14) and
  // an author spent a session debugging a page and an app that were both correct.
  //
  // Driven through the real doors: `ready` on the window, everything after it on the port the
  // parent hands back. No shortcut into the bridge — a preview-only path is the thing this whole
  // feature exists to refuse.
  describe("what the frame is told when it submits", () => {
    it("accepts a submission the declaration allows, and says why it cannot write it", async () => {
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-1", cid: "bookings", values: { slot: "roomA-1000", requesterName: "客" } });
      // The positive half first: once the confirmation is on screen we know the parent has finished
      // deciding, which is what makes "and it answered nothing" a fact rather than a race.
      await untilText(wrapper, "asks to write to");

      // It got PAST the declaration check — which an empty `submit` map makes impossible — and the
      // parent is now holding it for the author to confirm, with the values shown OUTSIDE the frame.
      expect(answers.filter((answer) => answer.type === "mc-public-view:submitResult")).toEqual([]);
      expect(wrapper.text()).toContain("roomA-1000");
    });

    it("writes the record when the author sends it, and answers the page", async () => {
      const { fetcher, posted } = answeringWrites({ ok: true, written: { cid: "bookings", id: "roomA-1000", token: "t-1" } });
      vi.stubGlobal("fetch", fetcher);
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-4", cid: "bookings", values: { slot: "roomA-1000" } });
      await press(wrapper, "Send it");
      await until(answered(answers, "r-4"), "an answer for r-4");

      // The submission reaches the server as the author accepted it — and the page is told, because
      // a submit has no timeout and a promise that never settles is a button that does nothing.
      expect(posted[0]?.url).toContain("/preview/submit");
      expect(posted[0]?.body).toEqual({ cid: "bookings", values: { slot: "roomA-1000" } });
      expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-4", ok: true }));
    });

    it("carries the server's refusal back to the page rather than reporting success", async () => {
      const { fetcher } = answeringWrites({ ok: false, error: "missing: 予約者" });
      vi.stubGlobal("fetch", fetcher);
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-6", cid: "bookings", values: { slot: "roomA-1000" } });
      await press(wrapper, "Send it");
      await until(answered(answers, "r-6"), "an answer for r-6");

      expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-6", ok: false, error: "missing: 予約者" }));
    });

    it("remembers what it wrote, and offers to take it back with its mirror", async () => {
      const { fetcher, posted } = answeringWrites({
        ok: true,
        written: { cid: "bookings", id: "roomA-1000", mirror: { cid: "slots", id: "roomA-1000" }, token: "t-1" },
      });
      vi.stubGlobal("fetch", fetcher);
      const wrapper = await mountPreview();
      const { port } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-7", cid: "bookings", values: { slot: "roomA-1000" } });
      await press(wrapper, "Send it");
      await untilText(wrapper, "1 record written from this preview");

      // The rules read a public create with `hasOnly(createFields)`, so nothing marks these records
      // in the database. This list is the only place they are known to be tests.
      expect(wrapper.text()).toContain("1 record written from this preview");
      expect(wrapper.text()).toContain("bookings / roomA-1000");

      await press(wrapper, "Remove them");
      await until(undoRequests(posted, 1), "the undo request to reach the server");

      // The MIRROR travels with it: a bare delete would leave the slot saying `taken` about a
      // booking that no longer exists.
      const undo = posted.find((entry) => entry.url.includes("/preview/undo"));
      // The TOKEN, and nothing the caller chose. Undo deletes through the author's own handle, so a
      // cid and an id off the wire would be a cid and an id of anybody's choosing.
      expect(undo?.body).toEqual({ token: "t-1" });
    });

    it("keeps taking records back after one undo request fails outright", async () => {
      // One undo REJECTS — a timeout, a dropped connection — rather than answering `ok: false`.
      // The records were written under a button that says it takes them all back, so the one that
      // failed must not decide the fate of the ones after it.
      const posted: { url: string; body: unknown }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
          const body: unknown = init?.body === undefined ? null : JSON.parse(init.body);
          if (url.includes("/preview/submit")) {
            const slot = isRecord(body) && isRecord(body.values) ? String(body.values.slot) : "";
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, written: { cid: "bookings", id: slot, token: `t-${slot}` } }) });
          }
          if (url.includes("/preview/undo")) {
            posted.push({ url, body });
            const sent = isRecord(body) && typeof body.token === "string" ? body.token : "";
            if (sent === "t-roomA-1100") return Promise.reject(new Error("timed out"));
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(payload()) });
        }),
      );
      const wrapper = await mountPreview();
      const { port } = await connect(wrapper);

      for (const [n, slot] of ["roomA-1000", "roomA-1100"].entries()) {
        port.postMessage({ type: "mc-public-view:submit", requestId: `r-${slot}`, cid: "bookings", values: { slot } });
        await press(wrapper, "Send it");
        // Each write has to be ON THE LIST before the next submit, or the second confirmation is
        // pressed against the first one's dialog. Waited on the pane's own count rather than on
        // `posted`, which this test fills from the UNDO route only.
        await untilText(wrapper, `${n + 1} record${n === 0 ? "" : "s"} written from this preview`);
      }
      await untilText(wrapper, "2 records written from this preview");
      expect(wrapper.text()).toContain("2 records written from this preview");

      await press(wrapper, "Remove them");
      // BOTH, not just the first: the assertion below is about the pair, so waiting for one would
      // read the list mid-flight.
      await until(undoRequests(posted, 2), "both undo requests to reach the server");

      // BOTH were attempted, and the one that could not be removed is still named on screen — the
      // author cannot delete by hand what this pane has forgotten.
      expect(posted.map((entry) => (isRecord(entry.body) ? entry.body.token : null))).toEqual(["t-roomA-1100", "t-roomA-1000"]);
      expect(wrapper.text()).toContain("bookings / roomA-1100");
      expect(wrapper.text()).not.toContain("bookings / roomA-1000");
    });

    it("answers the page when the author cancels, rather than leaving it waiting", async () => {
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-5", cid: "bookings", values: { slot: "roomA-1000" } });
      await press(wrapper, "Cancel");
      await until(answered(answers, "r-5"), "an answer for r-5");

      expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-5", ok: false, error: "cancelled" }));
      expect(wrapper.text()).not.toContain("asks to write to");
    });

    it("still refuses a cid the declaration does not name", async () => {
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-2", cid: "nowhere", values: { slot: "x" } });
      await until(answered(answers, "r-2"), "an answer for r-2");

      // The check is real, not switched off — this cid genuinely is not declared.
      expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-2", ok: false, error: "unknown-collection" }));
    });

    it("refuses a field outside createFields — the finding a preview exists to catch", async () => {
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-3", cid: "bookings", values: { slot: "roomA-1000", nickname: "x" } });
      await until(answered(answers, "r-3"), "an answer for r-3");

      expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-3", ok: false, error: "undeclared-field" }));
    });
  });

  it("starts a new document when the page changes, even if the HTML is identical", async () => {
    vi.stubGlobal(
      "fetch",
      answering(
        payload({
          pages: [
            { id: "desk", html: PAGE, audience: "member" },
            { id: "mine", html: PAGE, audience: "roster" },
          ],
        }),
      ),
    );

    const wrapper = await mountPreview();
    const first = wrapper.find("iframe").attributes("srcdoc") ?? "";
    await wrapper.find("select").setValue("roster:mine");
    await flushPromises();

    // Two pages can hold byte-identical HTML. Keeping the old document would hand the roster page's
    // records to a member page's still-running script, on a channel that was never restarted.
    expect(wrapper.find("iframe").attributes("srcdoc")).not.toBe(first);
  });

  it("hands a page only ITS OWN records", async () => {
    vi.stubGlobal(
      "fetch",
      answering(
        payload({
          pages: [
            { id: "public", html: PAGE, audience: "public" },
            { id: "desk", html: "<p>desk</p>", audience: "member" },
          ],
          datasets: { "public:public": { bookings: [] }, "member:desk": { notes: [{ id: "1" }] } },
        }),
      ),
    );

    const wrapper = await mountPreview();
    await wrapper.find("select").setValue("member:desk");
    await flushPromises();

    expect(wrapper.find("iframe").attributes("srcdoc")).toContain("desk");

    // And the DATA that reaches it is that page's alone. One map for the app would hand the member
    // page's rows to the public page's frame — the preview showing MORE than production, the one
    // direction it must never fail in. Asserted on what crosses the channel: the srcdoc only proves
    // which HTML was chosen, so a test that stopped there would pass on every dataset map there is.
    const { answers } = await connect(wrapper);
    // `connect` ends on flushPromises, which is one `setImmediate` — the check phase only. A port
    // message is not a microtask, so reading `answers` here catches it or misses it depending on
    // which phase it landed in and how loaded the runner is. Green on ubuntu/macOS, red on Windows.
    const state = await answerFor(answers, (answer) => answer.type === "mc-public-view:state", "the page's state");
    expect(state?.collections).toEqual({ notes: [{ id: "1" }] });
  });
});
