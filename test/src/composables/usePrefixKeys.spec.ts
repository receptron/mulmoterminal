import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { usePrefixKeys, type PrefixKeys } from "../../../src/composables/usePrefixKeys";
import { PREFIX_KEY_TIMEOUT_MS } from "../../../src/composables/prefixKeys";

// #2265. The wait's state and its lapse, and how a sequence shares a key with a single binding.
const host = (): PrefixKeys => {
  let keys: PrefixKeys | null = null;
  mount(
    defineComponent({
      setup() {
        keys = usePrefixKeys();
        return () => h("div");
      },
    }),
  );
  if (!keys) throw new Error("not mounted");
  return keys;
};

const event = (key: string, mods: { ctrlKey?: boolean } = {}) => ({
  type: "keydown",
  key,
  shiftKey: false,
  altKey: false,
  ctrlKey: mods.ctrlKey ?? false,
  metaKey: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

afterEach(() => vi.useRealTimers());

describe("usePrefixKeys", () => {
  it("clears the wait by itself when the time runs out, so the hint goes away", () => {
    vi.useFakeTimers();
    const keys = host();
    keys.claim({ "files-find": "Ctrl+k p" }, event("k", { ctrlKey: true }), true);
    expect(keys.pending.value).not.toBeNull();
    vi.advanceTimersByTime(PREFIX_KEY_TIMEOUT_MS);
    expect(keys.pending.value).toBeNull();
  });

  it("claims the prefix and the key after it, and returns the action", () => {
    const keys = host();
    const keymap = { "files-find": "Ctrl+k p" };
    const first = event("k", { ctrlKey: true });
    expect(keys.claim(keymap, first, true)).toBeNull();
    expect(first.preventDefault).toHaveBeenCalled();
    const second = event("p");
    expect(keys.claim(keymap, second, true)).toBe("files-find");
    expect(second.stopPropagation).toHaveBeenCalled();
    expect(keys.pending.value).toBeNull();
  });

  it("claims the second key but runs nothing when the action declines in this view state", () => {
    const keys = host();
    const keymap = { "files-find": "Ctrl+k p" }; // needs an enlarged terminal
    keys.claim(keymap, event("k", { ctrlKey: true }), false);
    const second = event("p");
    expect(keys.claim(keymap, second, false)).toBeNull();
    expect(second.preventDefault).toHaveBeenCalled();
  });

  it("lets a key bound on its own win over starting a sequence", () => {
    const keys = host();
    const keymap = { "zoom-toggle": "Ctrl+k", "files-find": "Ctrl+k p" };
    expect(keys.claim(keymap, event("k", { ctrlKey: true }), true)).toBe("zoom-toggle");
    expect(keys.pending.value).toBeNull();
  });

  it("gives the key after the prefix to the sequence even when it is bound on its own too", () => {
    const keys = host();
    const keymap = { "zoom-toggle": "p", "files-find": "Ctrl+k p" };
    keys.claim(keymap, event("k", { ctrlKey: true }), true);
    expect(keys.claim(keymap, event("p"), true)).toBe("files-find");
  });

  it("leaves a key that is not the grid's alone", () => {
    const keys = host();
    const other = event("x");
    expect(keys.claim({ "files-find": "Ctrl+k p" }, other, true)).toBeNull();
    expect(other.preventDefault).not.toHaveBeenCalled();
  });
});
