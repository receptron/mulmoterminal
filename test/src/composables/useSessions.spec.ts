import { describe, it, expect, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises } from "@vue/test-utils";
import { mergeStable, isUnread, useSessions, type Session } from "../../../src/composables/useSessions";

function row(id: string): Session {
  return { id, title: id, mtime: 1, working: false, waiting: false };
}

describe("isUnread", () => {
  it("is true for a waiting, non-hidden session", () => {
    expect(isUnread({ ...row("a"), waiting: true })).toBe(true);
  });

  it("is false when not waiting", () => {
    expect(isUnread(row("a"))).toBe(false);
  });

  it("is false for a hidden background worker even when waiting (the bug fix)", () => {
    expect(isUnread({ ...row("a"), waiting: true, hidden: true })).toBe(false);
  });
});

describe("mergeStable", () => {
  it("takes the server order on the first load (empty prev)", () => {
    const incoming = [row("a"), row("b")];
    expect(mergeStable([], incoming, false).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("keeps existing rows in place even when the server reorders them", () => {
    // The server sorts by recency; switching sessions bumps mtimes and would
    // otherwise reshuffle the list under the user.
    const prev = [row("a"), row("b")];
    const incoming = [row("b"), row("a")]; // b is now newest
    expect(mergeStable(prev, incoming, false).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("prepends genuinely-new sessions (newest-first) and drops vanished ones", () => {
    const prev = [row("a"), row("b")];
    const incoming = [row("c"), row("a")]; // b gone, c new; (no b)
    expect(mergeStable(prev, incoming, false).map((s) => s.id)).toEqual(["c", "a"]);
  });

  it("refreshes the data of kept rows in place", () => {
    const prev = [{ ...row("a"), working: false }];
    const incoming = [{ ...row("a"), working: true }];
    const merged = mergeStable(prev, incoming, false);
    expect(merged[0].working).toBe(true);
  });

  it("re-sorts to the server order when resort is requested", () => {
    const prev = [row("a"), row("b")];
    const incoming = [row("b"), row("a")];
    expect(mergeStable(prev, incoming, true).map((s) => s.id)).toEqual(["b", "a"]);
  });
});

// #620 F4: load() runs on every "sessions" push, so bursts put several requests in flight and
// they can answer out of order. Driven through the composable — the guard is about WHICH
// answer writes, which no pure function can show on its own.
describe("useSessions — out-of-order responses", () => {
  const listOf = (ids: string[]) => ({ ok: true, json: async () => ({ sessions: ids.map(row) }) });

  it("ignores an older answer that lands after a newer one", async () => {
    const releases: ((value: unknown) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("codex")) return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
        return new Promise((resolve) => releases.push(resolve));
      }),
    );
    const { sessions, load } = useSessions();
    const first = load();
    const second = load();
    await nextTick();

    // The newer request answers first, then the older one arrives late.
    releases[1]?.(listOf(["new"]));
    await second;
    releases[0]?.(listOf(["old"]));
    await first;
    await flushPromises();

    expect(sessions.value.map((s) => s.id)).toEqual(["new"]);
  });

  it("applies the answer when nothing newer was asked for", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(String(url).includes("codex") ? { ok: true, json: async () => ({ sessions: [] }) } : listOf(["a"])),
        ),
    );
    const { sessions, load } = useSessions();
    await load();
    await flushPromises();
    expect(sessions.value.map((s) => s.id)).toEqual(["a"]);
  });
});
