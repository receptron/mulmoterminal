import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TerminalKeysSection from "../../../../src/components/settings/TerminalKeysSection.vue";
import { setTmuxPrefix, tmuxPrefix } from "../../../../src/composables/tmuxPrefix";

// Settings -> Terminal keys offers the tmux prefix (#2981).
describe("Terminal keys: tmux prefix", () => {
  afterEach(() => {
    setTmuxPrefix(undefined);
    vi.unstubAllGlobals();
  });

  it("starts on none, lists the three choices, and saves the pick the server echoes", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => ({
      ok: true,
      json: async () => JSON.parse(init?.body ?? "{}"),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mount(TerminalKeysSection);
    const select = w.findAll("select")[1];
    expect(select?.element instanceof HTMLSelectElement && select.element.value).toBe("none");
    expect(select?.findAll("option").map((option) => option.element.value)).toEqual(["none", "C-b", "C-]"]);
    await select?.setValue("C-]");
    await flushPromises();
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")).toEqual({ tmuxPrefix: "C-]" });
    expect(tmuxPrefix.value).toBe("C-]");
  });

  it("shows a custom key from config.json as the current choice instead of a blank", () => {
    setTmuxPrefix("C-a");
    const select = mount(TerminalKeysSection).findAll("select")[1];
    expect(select?.element instanceof HTMLSelectElement && select.element.value).toBe("C-a");
    expect(select?.findAll("option").map((option) => option.element.value)).toEqual(["none", "C-b", "C-]", "C-a"]);
  });

  it("falls back to none for a value the server should never send", () => {
    setTmuxPrefix("C-; kill-server");
    expect(tmuxPrefix.value).toBe("none");
  });
});
