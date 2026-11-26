// #3506. A remote cell's session is read on its host: the prompts, the conversation, the timeline, the
// palette's prompt rows and the last code block all go through the gateway, and none asks this server
// about a session it has never seen. A local reader asks this server as before (the control).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { PROMPT_SUBMITTED_CHANNEL } from "../../../common/promptChannel";
import { REMOTE_PROMPT_SUBMITTED_CHANNEL } from "../../../common/remoteHosts";

const handlers = new Map<string, (data: unknown) => void>();
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (channel: string, cb: (data: unknown) => void) => {
      handlers.set(channel, cb);
      return () => handlers.delete(channel);
    },
    onReconnect: () => () => {},
  }),
}));

const PromptsPane = (await import("../../../src/components/PromptsPane.vue")).default;
const TranscriptPane = (await import("../../../src/components/TranscriptPane.vue")).default;
const TimelineOverlay = (await import("../../../src/components/TimelineOverlay.vue")).default;
const CopyCodeBlock = (await import("../../../src/components/CopyCodeBlock.vue")).default;
const { usePalettePrompts } = await import("../../../src/composables/usePalettePrompts");
const { promptSourceOf } = await import("../../../src/composables/palettePrompts");

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const RELOAD_SETTLED_MS = 450;
let asked: string[] = [];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ prompts: [], events: [], view: { status: "none", turns: [] }, older: null, text: "", reply: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  handlers.clear();
  document.body.innerHTML = "";
});

const routeOf = (url: string): string => url.split("?")[0] ?? "";
const allOn = (prefix: string): boolean => asked.length > 0 && asked.every((url) => url.startsWith(prefix));

describe("a remote session's reads", () => {
  it.each([
    ["lx", "/remote/lx/api/transcript/"],
    [null, "/api/transcript/"],
  ])("go to the session's host (%s)", async (host, prefix) => {
    const props = { sessionId: SESSION, cwd: "/srv/p", agent: "claude" as const, host };
    mount(PromptsPane, { props });
    mount(TranscriptPane, { props });
    mount(TimelineOverlay, { props: { ...props, open: true }, attachTo: document.body });
    const copy = mount(CopyCodeBlock, { props });
    await flushPromises();
    await copy.vm.copyLastBlock();
    await flushPromises();
    expect(allOn(prefix)).toBe(true);
    expect([...new Set(asked.map(routeOf))].sort()).toEqual([`${prefix}last-turn`, `${prefix}prompts`, `${prefix}timeline`, `${prefix}view`]);
    expect(asked.every((url) => url.includes(`session=${SESSION}`))).toBe(true);
  });

  // The same id and directory on another machine is another session: moving hosts reads again.
  it("read again from the new host when only the host changes", async () => {
    const props = { sessionId: SESSION, cwd: "/srv/p", agent: "claude" as const, host: null };
    const panes = [
      mount(PromptsPane, { props }),
      mount(TranscriptPane, { props }),
      mount(TimelineOverlay, { props: { ...props, open: true }, attachTo: document.body }),
    ];
    await flushPromises();
    asked = [];
    await Promise.all(panes.map((pane) => pane.setProps({ host: "lx" })));
    await flushPromises();
    expect([...new Set(asked.map(routeOf))].sort()).toEqual([
      "/remote/lx/api/transcript/prompts",
      "/remote/lx/api/transcript/timeline",
      "/remote/lx/api/transcript/view",
    ]);
  });

  it("read the palette's rows again when only the acting cell's host changes", async () => {
    const local = promptSourceOf({ uid: 2, session: SESSION, cwd: "/srv/p" });
    let source = local;
    const view = mount(
      defineComponent({
        props: { tick: { type: Number, default: 0 } },
        setup(props) {
          usePalettePrompts(() => (props.tick >= 0 ? source : null));
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    asked = [];
    source = local === null ? null : { ...local, host: "lx" };
    await view.setProps({ tick: 1 });
    await flushPromises();
    expect(asked.map(routeOf)).toEqual(["/remote/lx/api/transcript/prompts"]);
  });

  it("take the palette's prompt rows from the acting cell's host", async () => {
    const source = promptSourceOf({ uid: 2, session: SESSION, cwd: "/srv/p", agent: "codex", remoteHost: "lx" });
    expect(source?.host).toBe("lx");
    mount(
      defineComponent({
        setup() {
          usePalettePrompts(() => source);
          return () => h("div");
        },
      }),
    );
    await flushPromises();
    expect(asked.map(routeOf)).toEqual(["/remote/lx/api/transcript/prompts"]);
    expect(promptSourceOf({ uid: 2, session: SESSION, cwd: "/w" })?.host).toBeNull();
  });
});

// The pane keeps up off the prompt its host announces, relayed with the host's name; this machine's
// `prompt-submitted` names this machine's sessions.
describe("a remote cell's Prompts pane, left open", () => {
  const reloadsAfter = async (host: string | null, channel: string, data: unknown): Promise<boolean> => {
    mount(PromptsPane, { props: { sessionId: SESSION, cwd: "/srv/p", agent: "claude", host } });
    await flushPromises();
    const before = asked.length;
    handlers.get(channel)?.(data);
    await new Promise((resolve) => setTimeout(resolve, RELOAD_SETTLED_MS));
    await flushPromises();
    return asked.length > before;
  };

  it("reloads on its own host's prompt for its session", async () => {
    expect(await reloadsAfter("lx", REMOTE_PROMPT_SUBMITTED_CHANNEL, { host: "lx", sessionId: SESSION })).toBe(true);
  });
  it.each([
    ["another host", { host: "other", sessionId: SESSION }],
    ["another session", { host: "lx", sessionId: "11111111-2222-4333-8444-555555555555" }],
    ["no host", { sessionId: SESSION }],
  ])("ignores %s", async (_name, data) => {
    expect(await reloadsAfter("lx", REMOTE_PROMPT_SUBMITTED_CHANNEL, data)).toBe(false);
  });
  it("ignores this machine's prompt with the same id", async () => {
    expect(await reloadsAfter("lx", PROMPT_SUBMITTED_CHANNEL, { sessionId: SESSION })).toBe(false);
  });
  it("is the local pane's reverse (control)", async () => {
    expect(await reloadsAfter(null, PROMPT_SUBMITTED_CHANNEL, { sessionId: SESSION })).toBe(true);
    handlers.clear();
    document.body.innerHTML = "";
    expect(await reloadsAfter(null, REMOTE_PROMPT_SUBMITTED_CHANNEL, { host: "lx", sessionId: SESSION })).toBe(false);
  });
});
