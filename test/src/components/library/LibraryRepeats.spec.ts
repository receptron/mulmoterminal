// The Library's Repeats view (#3334): the candidates most typed first, narrowed by the search, the
// one being read with where it was typed lately, and "Make a rule" / "Make a skill" asking for it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { provideOverlayVisible } from "../../../../src/composables/overlayVisibility";
import type { RepeatCandidate, RepeatDetail } from "../../../../common/libraryRepeats";
import type { LibraryConversation } from "../../../../common/library";

const NOW = Date.now();
const fullConversation: LibraryConversation = {
  ...{ id: "s2", agent: "claude", title: "t", cwd: "/w/app", gitBranch: null, prs: [], costUsd: null, linesAdded: null, linesRemoved: null },
  ...{ startedAt: 1, endedAt: 2, skills: [], hookErrors: 0, userTurns: 1, isSidechain: false, parentId: null, isTemporary: false, entrypoint: "cli" },
};
const candidate = (id: string, text: string, over: Partial<RepeatCandidate> = {}): RepeatCandidate => ({
  id,
  text,
  variants: [text],
  count: 3,
  sessions: 2,
  projects: ["/w/app"],
  lastAt: NOW,
  ...over,
});
let listed: RepeatCandidate[] | null = [];
let extraTotal = 0;
const promotes: unknown[][] = [];
let refusal: string | null = null;
let conversation: LibraryConversation | null = null;
let openConversation: (() => Promise<LibraryConversation | null>) | null = null;
vi.mock("../../../../src/composables/libraryApi", () => ({
  loadLibraryRepeats: () => Promise.resolve(listed === null ? null : { candidates: listed, total: listed.length + extraTotal }),
  loadLibraryRepeat: (id: string): Promise<RepeatDetail | null> => {
    const found = listed?.find((c) => c.id === id);
    return Promise.resolve(
      found === undefined
        ? null
        : {
            ...found,
            occurrences: [
              { sessionId: "s2", project: "/w/app", at: NOW, text: found.text },
              { sessionId: "s2", project: "/w/app", at: NOW - 1, text: found.text },
              { sessionId: "s1", project: null, at: NOW - 2, text: found.text },
            ],
          },
    );
  },
  loadLibraryConversation: () => (openConversation ?? (() => Promise.resolve(conversation)))(),
}));
vi.mock("../../../../src/components/library/libraryPromoteStart", () => ({
  startRepeatPromote: (id: string, target: string) => (promotes.push([id, target]), Promise.resolve(refusal)),
}));

const LibraryRepeats = (await import("../../../../src/components/library/LibraryRepeats.vue")).default;

const mountWith = async (query = "") => {
  const wrapper = mount(LibraryRepeats, { props: { query, now: NOW } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  listed = [
    candidate("aaaaaaaaaaaaaaaa", "CI通ったらマージして", { count: 9, variants: ["CI通ったらマージして", "CI が通ったらマージして"] }),
    candidate("bbbbbbbbbbbbbbbb", "コミットしてPR作って"),
  ];
  promotes.length = 0;
  refusal = null;
  conversation = null;
  openConversation = null;
  extraTotal = 0;
});

describe("LibraryRepeats", () => {
  it("lists the candidates and reads the first, with its other forms and where it was typed lately", async () => {
    const wrapper = await mountWith();
    expect(wrapper.findAll('[data-testid="repeat-row"]').map((row) => row.text())).toEqual([
      expect.stringContaining("CI通ったら"),
      expect.stringContaining("コミット"),
    ]);
    expect(wrapper.get('[data-testid="repeat-reader"] h2').text()).toBe("CI通ったらマージして");
    expect(wrapper.findAll('[data-testid="repeat-variant"]').map((v) => v.text())).toEqual(["CI が通ったらマージして"]);
    expect(wrapper.findAll('[data-testid="repeat-session"]')).toHaveLength(2);
  });

  it("narrows to the ones the search matches, by any form or directory", async () => {
    const wrapper = await mountWith("が通った");
    expect(wrapper.findAll('[data-testid="repeat-row"]')).toHaveLength(1);
    expect((await mountWith("/w/app")).findAll('[data-testid="repeat-row"]')).toHaveLength(2);
    expect((await mountWith("nothing like it")).find('[data-testid="library-repeats"]').exists()).toBe(false);
  });

  it("asks for a rule or a skill for the one being read, and says why when it was refused", async () => {
    const wrapper = await mountWith();
    await wrapper.get('[data-testid="repeat-promote-rule"]').trigger("click");
    await flushPromises();
    expect(promotes).toEqual([["aaaaaaaaaaaaaaaa", "rule"]]);
    expect(wrapper.find('[data-testid="repeat-notice"]').exists()).toBe(false);
    refusal = "libraryView.repeats.noDir";
    await wrapper.get('[data-testid="repeat-promote-skill"]').trigger("click");
    await flushPromises();
    expect(promotes.at(-1)).toEqual(["aaaaaaaaaaaaaaaa", "skill"]);
    expect(wrapper.get('[data-testid="repeat-notice"]').text()).not.toBe("");
  });

  it("opens a conversation it was typed in, or says it is not in the Library", async () => {
    const wrapper = await mountWith();
    await wrapper.findAll('[data-testid="repeat-session"]')[0]?.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("open-conversation")).toBeUndefined();
    expect(wrapper.get('[data-testid="repeat-notice"]').text()).not.toBe("");
    conversation = fullConversation;
    await wrapper.findAll('[data-testid="repeat-session"]')[0]?.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("open-conversation")).toEqual([[conversation]]);
  });

  it("opens only the conversation clicked last, when an earlier click answers later", async () => {
    const wrapper = await mountWith();
    const answers: Array<(value: LibraryConversation | null) => void> = [];
    openConversation = () => new Promise((resolve) => answers.push(resolve));
    const rows = wrapper.findAll('[data-testid="repeat-session"]');
    await rows[0]?.trigger("click");
    await rows[1]?.trigger("click");
    const later = { ...fullConversation, id: "later" };
    answers[1]?.(later);
    answers[0]?.({ ...fullConversation, id: "earlier" });
    await flushPromises();
    expect(wrapper.emitted("open-conversation")).toEqual([[later]]);
  });

  it("says how many there are when the list holds only the most typed", async () => {
    expect((await mountWith()).find('[data-testid="repeats-more"]').exists()).toBe(false);
    extraTotal = 40;
    expect((await mountWith()).get('[data-testid="repeats-more"]').text()).toContain("42");
  });

  it("walks the candidates with the arrow keys, stopping at the ends", async () => {
    const wrapper = await mountWith();
    const view = wrapper.vm as unknown as { move(by: number): Promise<void> };
    await view.move(-1);
    expect(wrapper.get('[data-testid="repeat-reader"] h2').text()).toBe("CI通ったらマージして");
    await view.move(5);
    expect(wrapper.get('[data-testid="repeat-reader"] h2').text()).toBe("コミットしてPR作って");
  });

  it("says when there is nothing, and when the history could not be read", async () => {
    listed = [];
    expect((await mountWith()).find('[data-testid="repeats-empty"]').exists()).toBe(true);
    listed = null;
    expect((await mountWith()).find('[data-testid="repeats-failed"]').exists()).toBe(true);
  });

  // The Library is kept while closed: shown again, the list is read again, and a failed re-read keeps it.
  it("reads the list again each time the Library is shown, keeping it through a failed read", async () => {
    listed = [candidate("a", "run the tests")];
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(LibraryRepeats, { query: "", now: NOW })) });
    const wrapper = mount(Host);
    await flushPromises();
    const showAgain = async () => {
      visible.value = false;
      await flushPromises();
      visible.value = true;
      await flushPromises();
    };
    listed = [candidate("a", "run the tests"), candidate("b", "open a PR")];
    await showAgain();
    expect(wrapper.findAll("[data-testid=repeat-row]")).toHaveLength(2);
    listed = null;
    await showAgain();
    expect(wrapper.findAll("[data-testid=repeat-row]")).toHaveLength(2);
    expect(wrapper.find("[data-testid=repeats-failed]").exists()).toBe(false);
    wrapper.unmount();
  });
});
