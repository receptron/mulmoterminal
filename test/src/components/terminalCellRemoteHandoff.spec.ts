import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// #3506. A remote terminal is one the Talk menu hands turns to and from: its last turn and its relay
// are read on its host. An exchange and a round table wait on each seat's turn as this server sees
// it, so they seat only this machine's terminals.

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

vi.mock("../../../src/components/Terminal.vue", () => ({
  default: {
    name: "TerminalView",
    props: ["sessionId", "connectKey", "cwd", "hideHeader"],
    emits: ["session", "cwd"],
    template: '<div class="stub-term"><slot v-if="!hideHeader" name="header-lead" /><slot v-if="!hideHeader" name="header-actions" /></div>',
    methods: {
      terminate() {},
    },
  },
}));

const LOCAL = { key: "cell-2", label: "#2 · codex", source: { sessionId: "22222222-2222-4222-8222-222222222222", cwd: "/w", agent: "claude" } };
const REMOTE = {
  key: "cell-3",
  label: "#3 · lx · claude",
  source: { sessionId: "33333333-3333-4333-8333-333333333333", cwd: "/srv/p", agent: "claude", host: "lx" },
};
vi.mock("../../../src/composables/useHandoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useHandoff")>()),
  handoffTargets: () => [LOCAL, REMOTE],
}));

const TerminalCell = (await import("../../../src/components/TerminalCell.vue")).default;
const RoundTableMenu = (await import("../../../src/components/RoundTableMenu.vue")).default;

const SELF_CWD = "/home/me/proj";
let asked: string[] = [];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ status: "nothing-new", text: "", mark: null, prompt: null, reply: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const mountCell = () =>
  mount(TerminalCell, {
    props: {
      uid: 1,
      expanded: false,
      zoomed: false,
      reorderable: false,
      initialSessionId: "11111111-1111-4111-8111-111111111111",
      initialCwd: SELF_CWD,
      defaultCwd: SELF_CWD,
      presets: [],
      home: "/home/me",
      cancellable: false,
      openSessionIds: [],
      openCwds: [],
    },
    attachTo: document.body,
  });

async function openTalk(w: ReturnType<typeof mountCell>): Promise<void> {
  w.findComponent({ name: "TerminalView" }).vm.$emit("cwd", SELF_CWD);
  await w.find('[data-testid="cell-tools-btn"]').trigger("click");
  await flushPromises();
  document.body.querySelector<HTMLElement>('[data-testid="cell-pane-menu-talk"]')?.click();
  await flushPromises();
}

const rowOf = (w: ReturnType<typeof mountCell>, index: number) => w.findAll('[data-testid="cell-ask-list"] > div')[index];

describe("a local cell's Talk menu with a remote terminal in it", () => {
  it("hands turns to and from both, and seats only this machine's terminal at an exchange or a table", async () => {
    const w = mountCell();
    await openTalk(w);
    expect(w.findAll('[data-testid="cell-ask-item"]').map((item) => item.text())).toEqual([LOCAL.label, REMOTE.label]);
    expect(rowOf(w, 0)?.find('[data-testid="cell-exchange-item"]').exists()).toBe(true);
    expect(rowOf(w, 1)?.find('[data-testid="cell-exchange-item"]').exists()).toBe(false);
    expect(rowOf(w, 1)?.find('[data-testid="cell-send-turn-item"]').exists()).toBe(true);
    expect(w.findComponent(RoundTableMenu).props("targets")).toEqual([LOCAL]);
  });

  it("brings the remote terminal's last turn and its relay from its host", async () => {
    const w = mountCell();
    await openTalk(w);
    await rowOf(w, 1)?.find('[data-testid="cell-ask-item"]').trigger("click");
    await flushPromises();
    await openTalk(w);
    await rowOf(w, 1)?.find('[data-testid="cell-relay-item"]').trigger("click");
    await flushPromises();
    const transcript = asked.filter((url) => url.includes("/transcript/"));
    expect(transcript.map((url) => url.split("?")[0])).toEqual(["/remote/lx/api/transcript/last-turn", "/remote/lx/api/transcript/relay"]);
    // Remembered on the remote under this machine's directory: the empty host and the path.
    expect(new URL(transcript[1] ?? "", "https://x").searchParams.get("dest")).toBe(`\0${SELF_CWD}`);
  });

  it("brings this machine's terminal's from this server (control)", async () => {
    const w = mountCell();
    await openTalk(w);
    await rowOf(w, 0)?.find('[data-testid="cell-relay-item"]').trigger("click");
    await flushPromises();
    const relay = asked.find((url) => url.includes("/transcript/relay"));
    expect(relay?.startsWith("/api/transcript/relay?")).toBe(true);
    expect(new URL(relay ?? "", "https://x").searchParams.get("dest")).toBe(SELF_CWD);
  });
});
