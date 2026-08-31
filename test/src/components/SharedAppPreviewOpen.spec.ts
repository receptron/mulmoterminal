// OPENING ONE OF THE APP'S OWN ARTICLES, from inside the sandbox.
//
// The index at `/a/{slug}` is the app's own HTML — the platform draws one page for an app and it is
// the ARTICLE at `/a/{slug}/{id}`. So a magazine's front page is nothing but links, and a link is
// the one thing a published page cannot follow: the frame is `sandbox="allow-scripts"`, with no
// top navigation and no popups. It asks the host instead.
//
// This pane does not go anywhere, and BOTH halves of that are what these pin. The page must be
// ANSWERED — a promise nothing settles is a headline that does nothing — and the author must be
// TOLD, or a click that moves nothing on their own front page looks exactly like one they failed to
// wire.
//
// Its own file rather than another block in `SharedAppPreview.spec.ts`: that file is at its
// 600-line cap, and the harness below is the small half of its own — no writes, no clipboard
// beyond the record, no tiers.
//
// Imported at module scope, not inside a test: the component's module graph is billed to whichever
// test first reaches it, and that has made a file's first test look 100x slower than its siblings.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import SharedAppPreview from "../../../src/components/SharedAppPreview.vue";
import { until } from "../../helpers/hopUntil";

const PAGE = "<h1>AI Journal</h1>";

/** An app that publishes articles: a front page of its own, and the `articleCid` the parent judges
 *  an `open` against. */
const magazine = (over: Record<string, unknown> = {}) => ({
  declared: true,
  ok: true,
  preview: {
    aid: "aid-1",
    submit: { articles: { createFields: ["slug", "title", "body"] } },
    articleCid: "articles",
    pages: [{ id: "public", html: PAGE, audience: "public" }],
    publicFace: "open",
    fromLiveApp: false,
    generatedForm: false,
    datasets: { "public:public": { articles: [] } },
    unreadable: [],
    warnings: [],
    ...over,
  },
});

const answering = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });

let clipboard = "";

beforeEach(() => {
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

const mountPreview = async () => {
  const wrapper = mount(SharedAppPreview, { props: { cwd: "/repo" } });
  await flushPromises();
  return wrapper;
};

/** Do the handshake and return the far end of the private channel. */
const connect = async (wrapper: VueWrapper) => {
  const frame = wrapper.find("iframe").element as HTMLIFrameElement;
  const nonce = /const nonce = "([^"]+)"/.exec(frame.getAttribute("srcdoc") ?? "")?.[1] ?? "";

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
  return { port, answers };
};

const answered = (answers: Record<string, unknown>[], requestId: string) => () => answers.some((answer) => answer.requestId === requestId);

/** What the pane put on the clipboard, once it says what the test is about to assert. Re-read on
 *  each hop: the block is built when the button is pressed, so waiting on one copy would wait for
 *  ever, and the block that SATISFIED the wait is the one handed back. */
const untilBlock = async (wrapper: VueWrapper, text: string): Promise<string> => {
  let found = "";
  const says = async (): Promise<boolean> => {
    const button = wrapper.findAll("button").find((candidate) => (candidate.attributes("title") ?? "").startsWith("Everything the parent saw"));
    if (button === undefined) return false;
    await button.trigger("click");
    await flushPromises();
    found = clipboard;
    return found.includes(text);
  };
  await until(says, `the record to mention ${JSON.stringify(text)}`);
  return found;
};

/** The ask, as the bootstrap posts it. */
const open = (over: Record<string, unknown> = {}) => ({
  type: "mc-public-view:open",
  requestId: "r-open",
  cid: "articles",
  id: "why-terminals-won",
  ...over,
});

describe("opening one of the app's own articles", () => {
  it("answers the page, and tells the author what the published one would have done", async () => {
    vi.stubGlobal("fetch", answering(magazine()));
    const wrapper = await mountPreview();
    const { port, answers } = await connect(wrapper);

    port.postMessage(open());
    await until(answered(answers, "r-open"), "an answer for r-open");

    // ANSWERED AS AN OPEN — `{ opened }` rather than `{ ok }`, so a page cannot read "this host does
    // not navigate" as "that article does not exist".
    expect(answers).toContainEqual(expect.objectContaining({ type: "mc-public-view:openResult", requestId: "r-open", opened: false, reason: "no-navigation" }));
    const block = await untilBlock(wrapper, "asked to open");
    expect(block).toContain("the page asked to open 'why-terminals-won' in 'articles'");
  });

  it("refuses a collection this app does not draw articles from", async () => {
    // `/a/{slug}/{id}` has nothing in it to say which collection an id belongs to, so a host that
    // navigated anyway would land the reader on a page reading a record of another collection —
    // an address that looks broken to whoever was handed the link.
    vi.stubGlobal("fetch", answering(magazine()));
    const wrapper = await mountPreview();
    const { port, answers } = await connect(wrapper);

    port.postMessage(open({ requestId: "r-wrong", cid: "notes" }));
    await until(answered(answers, "r-wrong"), "an answer for r-wrong");

    expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-wrong", opened: false, reason: "unknown-collection" }));
  });

  it("has no article page to reach on an app that publishes none", async () => {
    // `articleCid` absent, which is most apps. Absent has to REFUSE rather than match nothing by
    // accident — see `sharedAppPreviewPayload.spec.ts` on why it is not floored to "".
    vi.stubGlobal("fetch", answering(magazine({ articleCid: undefined })));
    const wrapper = await mountPreview();
    const { port, answers } = await connect(wrapper);

    port.postMessage(open({ requestId: "r-none" }));
    await until(answered(answers, "r-none"), "an answer for r-none");

    expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-none", opened: false, reason: "unknown-collection" }));
  });

  it("does not offer it on a MEMBER page, which production never would", async () => {
    // The article page is published under the PUBLIC entrance alone. A member page's own parent in
    // production is handed no article declaration and refuses the ask — so a pane that answered
    // "the published page would go there" here would be validating a link that does not exist.
    vi.stubGlobal("fetch", answering(magazine({ pages: [{ id: "desk", html: PAGE, audience: "member", viewer: { me: "owner@x.jp", can: {} } }] })));
    const wrapper = await mountPreview();
    const { port, answers } = await connect(wrapper);

    port.postMessage(open({ requestId: "r-desk" }));
    await until(answered(answers, "r-desk"), "an answer for r-desk");

    expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-desk", opened: false, reason: "unknown-collection" }));
  });

  it("refuses an id that is not a single path segment, before it can reach a URL", async () => {
    // The grammar is the defence that does not depend on a host remembering to encode. Pinned here
    // as well as in the package because this is the path a real page takes.
    vi.stubGlobal("fetch", answering(magazine()));
    const wrapper = await mountPreview();
    const { port, answers } = await connect(wrapper);

    port.postMessage(open({ requestId: "r-bad", id: "../secrets" }));
    await until(answered(answers, "r-bad"), "an answer for r-bad");

    expect(answers).toContainEqual(expect.objectContaining({ requestId: "r-bad", opened: false, reason: "invalid-open" }));
  });
});
