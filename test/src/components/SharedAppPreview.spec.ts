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

const PAGE = "<h1>Book</h1>";

const FORM_FIELD = { name: "name", label: "お名前", required: true, type: "string" };

/** One collection's capability, as the server resolves it for the author. Written out rather than
 *  built, so the SHAPE a page reads is pinned here too: `can` is keyed by collection, and a page
 *  reaching for `viewer.can.transitionAny` gets undefined for every app that has ever existed. */
const MEMBER_CAPABILITY = { cid: "bookings", transitionAny: true, transitionOwn: false, assign: false, assignees: [], withdrawFrom: [] };

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
    pages: [{ id: "public", html: PAGE, audience: "public" }],
    publicOpen: true,
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

const copyBlock = async (wrapper: VueWrapper): Promise<string> => {
  // Found by its title rather than its label: the label becomes "Copied" for a moment after a
  // press, and a helper that looked for the label would quietly stop finding it on the second call.
  const button = wrapper.findAll("button").find((candidate) => (candidate.attributes("title") ?? "").startsWith("Everything the parent saw"));
  if (button === undefined) throw new Error("the pane offers no way to copy what happened");
  await button.trigger("click");
  await flushPromises();
  return clipboard;
};

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

const mountPreview = async () => {
  const wrapper = mount(SharedAppPreview, { props: { cwd: "/repo" } });
  await flushPromises();
  return wrapper;
};

describe("SharedAppPreview", () => {
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
    await settle();

    const block = await copyBlock(wrapper);
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
    await settle();

    const block = await copyBlock(wrapper);
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
    await settle();
    expect(await copyBlock(wrapper)).not.toContain("from the first app");
  });

  it("keeps what was recorded when the same app is merely re-read", async () => {
    // Every accepted write re-reads the projection, and so does Remove them. Emptying the log there
    // would lose it at the exact moment an author had finished reproducing something.
    const wrapper = await mountPreview();
    await speakFromFrame(wrapper, { type: "mc-public-view:notice", nonce: nonceOf(wrapper), code: "error", detail: "still worth reading" });
    await wrapper.setProps({ cwd: "/repo" });
    await settle();
    expect(await copyBlock(wrapper)).toContain("still worth reading");
  });

  it("names the collection a cancelled confirmation was for", async () => {
    // `decline()` settles the confirmation and THEN answers, so the cell is already null by the
    // time the answer goes past — read there, every cancellation named an empty collection.
    const wrapper = await mountPreview();
    const { port } = await connect(wrapper);
    port.postMessage({ type: "mc-public-view:submit", requestId: "r1", cid: "bookings", values: { slot: "a" } });
    await settle();
    const cancel = wrapper.findAll("button").find((candidate) => candidate.text() === "Cancel");
    await cancel?.trigger("click");
    await settle();

    expect(await copyBlock(wrapper)).toContain("the confirmation for 'bookings' was declined");
  });

  it("can still be copied when the pane never got a declaration to show", async () => {
    // The unreachable server and the unreadable answer are exactly the cases the host events were
    // added for, and both leave `declared` false — a control hidden behind it is hidden precisely
    // when the diagnostic exists.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")));
    const wrapper = await mountPreview();
    await settle();

    expect(await copyBlock(wrapper)).toContain("could not reach this host's own server");
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
    const state = answers.find((message) => message.type === "mc-public-view:state");
    expect(state).toBeDefined();
    expect(state?.viewer).toEqual({ me: "owner@gym.jp", can: { bookings: MEMBER_CAPABILITY } });
    wrapper.unmount();
  });

  // A public page must NOT get one. It has no reader and no roles, and a `viewer` there would be an
  // answer to a question that page never asks — the pane sending one anyway is how a public page
  // starts branching on something only a member has.
  it("sends no viewer to a public page", async () => {
    const wrapper = await mountPreview();
    const { answers } = await connect(wrapper);
    const state = answers.find((message) => message.type === "mc-public-view:state");
    expect(state).toBeDefined();
    expect(state).not.toHaveProperty("viewer");
    wrapper.unmount();
  });

  // The member parent performs nothing — the pane has no route for a member's write — so an intent
  // is answered BY NAME rather than dropped. A view left on a promise is, to the person holding the
  // phone, a button that does nothing, which is the symptom this whole pane exists to explain.
  it("answers a member page's intent instead of leaving it waiting", async () => {
    vi.stubGlobal("fetch", answering(memberPayload()));
    const wrapper = await mountPreview();
    const { port, answers } = await connect(wrapper);
    port.postMessage({ type: "mc-public-view:intent", requestId: "r1", kind: "transition", cid: "bookings", itemId: "b1", to: "approved" });
    await settle();
    // `submitResult`, not `result`: one name answers a submission and an intent alike, because the
    // view awaits one promise either way.
    const result = answers.find((message) => message.type === "mc-public-view:submitResult" && message.requestId === "r1");
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    expect(result?.error).toBe("read-only");
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
    await wrapper
      .findAll("button")
      .filter((button) => button.text() === "Send it")[0]
      ?.trigger("click");
    await settle();

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
    await wrapper
      .findAll("button")
      .filter((button) => button.text() === "Send it")[0]
      ?.trigger("click");
    await settle();

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
    await wrapper
      .findAll("button")
      .filter((button) => button.text() === "Send it")[0]
      ?.trigger("click");
    await settle();

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
      await settle();

      // It got PAST the declaration check — which an empty `submit` map makes impossible — and the
      // parent is now holding it for the author to confirm, with the values shown OUTSIDE the frame.
      expect(answers.filter((answer) => answer.type === "mc-public-view:submitResult")).toEqual([]);
      expect(wrapper.text()).toContain("asks to write to");
      expect(wrapper.text()).toContain("roomA-1000");
    });

    it("writes the record when the author sends it, and answers the page", async () => {
      const { fetcher, posted } = answeringWrites({ ok: true, written: { cid: "bookings", id: "roomA-1000", token: "t-1" } });
      vi.stubGlobal("fetch", fetcher);
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-4", cid: "bookings", values: { slot: "roomA-1000" } });
      await settle();
      await wrapper
        .findAll("button")
        .filter((button) => button.text() === "Send it")[0]
        ?.trigger("click");
      await settle();

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
      await settle();
      await wrapper
        .findAll("button")
        .filter((button) => button.text() === "Send it")[0]
        ?.trigger("click");
      await settle();

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
      await settle();
      await wrapper
        .findAll("button")
        .filter((button) => button.text() === "Send it")[0]
        ?.trigger("click");
      await settle();

      // The rules read a public create with `hasOnly(createFields)`, so nothing marks these records
      // in the database. This list is the only place they are known to be tests.
      expect(wrapper.text()).toContain("1 record written from this preview");
      expect(wrapper.text()).toContain("bookings / roomA-1000");

      await wrapper
        .findAll("button")
        .filter((button) => button.text() === "Remove them")[0]
        ?.trigger("click");
      await settle();

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

      for (const slot of ["roomA-1000", "roomA-1100"]) {
        port.postMessage({ type: "mc-public-view:submit", requestId: `r-${slot}`, cid: "bookings", values: { slot } });
        await settle();
        await wrapper
          .findAll("button")
          .filter((button) => button.text() === "Send it")[0]
          ?.trigger("click");
        await settle();
      }
      expect(wrapper.text()).toContain("2 records written from this preview");

      await wrapper
        .findAll("button")
        .filter((button) => button.text() === "Remove them")[0]
        ?.trigger("click");
      await settle();

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
      await settle();
      await wrapper
        .findAll("button")
        .filter((button) => button.text() === "Cancel")[0]
        ?.trigger("click");
      await settle();

      expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-5", ok: false, error: "cancelled" }));
      expect(wrapper.text()).not.toContain("asks to write to");
    });

    it("still refuses a cid the declaration does not name", async () => {
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-2", cid: "nowhere", values: { slot: "x" } });
      await settle();

      // The check is real, not switched off — this cid genuinely is not declared.
      expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-2", ok: false, error: "unknown-collection" }));
    });

    it("refuses a field outside createFields — the finding a preview exists to catch", async () => {
      const wrapper = await mountPreview();
      const { port, answers } = await connect(wrapper);

      port.postMessage({ type: "mc-public-view:submit", requestId: "r-3", cid: "bookings", values: { slot: "roomA-1000", nickname: "x" } });
      await settle();

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
    await settle();
    const state = answers.find((answer) => answer.type === "mc-public-view:state");
    expect(state?.collections).toEqual({ notes: [{ id: "1" }] });
  });
});
