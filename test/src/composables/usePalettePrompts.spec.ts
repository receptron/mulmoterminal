import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { PalettePromptSource } from "../../../src/composables/palettePrompts";

const server = vi.hoisted(() => ({ asked: [] as string[], fail: false, hold: null as Promise<void> | null }));
vi.mock("../../../src/utils/fetchWithTimeout", () => ({
  fetchWithTimeout: async (url: string) => {
    server.asked.push(url);
    const session = new URLSearchParams(url.split("?")[1] ?? "").get("session");
    await server.hold;
    if (server.fail) return new Response("{}", { status: 500 });
    return new Response(
      JSON.stringify({
        prompts: [
          { at: 1, text: `first of ${session}` },
          { at: 2, text: `last of ${session}` },
          { at: 3, text: "" },
        ],
      }),
    );
  },
}));

const { usePalettePrompts } = await import("../../../src/composables/usePalettePrompts");

const sourceFor = (session: string): PalettePromptSource => ({ uid: 1, slotKey: "cell-1", session, agent: "codex", cwd: "/w", host: null });

const mountPrompts = (source: () => PalettePromptSource | null) =>
  mount(
    defineComponent({
      setup() {
        const { prompts } = usePalettePrompts(source);
        return () => h("div", prompts.value.map((prompt) => prompt.text).join("|"));
      },
    }),
  );

beforeEach(() => {
  server.asked.length = 0;
  server.fail = false;
  server.hold = null;
});

describe("usePalettePrompts", () => {
  it("reads the acting terminal's history, newest first, as the Prompts pane asks for it", async () => {
    const w = mountPrompts(() => sourceFor("s1"));
    await flushPromises();
    expect(w.text()).toBe("last of s1|first of s1");
    expect(server.asked).toEqual(["/api/transcript/prompts?session=s1&agent=codex&cwd=%2Fw"]);
    w.unmount();
  });

  it("asks nothing without an agent terminal", async () => {
    const w = mountPrompts(() => null);
    await flushPromises();
    expect(server.asked).toEqual([]);
    expect(w.text()).toBe("");
    w.unmount();
  });

  it("lists nothing when the history cannot be read", async () => {
    server.fail = true;
    const w = mountPrompts(() => sourceFor("s1"));
    await flushPromises();
    expect(w.text()).toBe("");
    w.unmount();
  });

  // The terminal changed while its history was being read: the old answer must not land.
  it("drops the history of a terminal it moved off", async () => {
    let release: () => void = () => {};
    server.hold = new Promise<void>((resolve) => (release = resolve));
    const acting = ref("s1");
    const w = mountPrompts(() => sourceFor(acting.value));
    await flushPromises();
    server.hold = null;
    acting.value = "s2";
    await nextTick();
    await flushPromises();
    release();
    await flushPromises();
    expect(w.text()).toBe("last of s2|first of s2");
    w.unmount();
  });

  // The Prompts pane reads again when the cwd moves under the same session, and so does this.
  it("reads again when the terminal's directory changes", async () => {
    const cwd = ref<string | null>("/w");
    const w = mountPrompts(() => ({ ...sourceFor("s1"), cwd: cwd.value }));
    await flushPromises();
    cwd.value = "/w/sub";
    await nextTick();
    await flushPromises();
    expect(server.asked.at(-1)).toContain("cwd=%2Fw%2Fsub");
    expect(server.asked).toHaveLength(2);
    w.unmount();
  });
});
