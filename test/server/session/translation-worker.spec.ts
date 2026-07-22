import { describe, it, expect, vi, afterEach } from "vitest";
import { createTranslationWorker, submitTranslation, failPendingTranslation } from "../../../server/session/translation-worker.js";
import { hiddenSessions, translationWorkerIds, knownSessions, activity, lastPrompts } from "../../../server/session/registry.js";

// The worker's answer arrives on a different code path (POST /api/translation/submit)
// than the request waiting for it, so these two functions are the whole handoff. A
// missed settle hangs the caller until the 2-minute timeout.
afterEach(() => {
  vi.useRealTimers();
  hiddenSessions.clear();
  translationWorkerIds.clear();
  knownSessions.clear();
  activity.clear();
  lastPrompts.clear();
});

// Captures the id the worker spawns with, and lets the test answer as that worker would.
function harness(answer?: (sessionId: string) => void) {
  const reaped: string[] = [];
  const spawned: Array<{ sessionId: string; prompt: string }> = [];
  const { translateViaHiddenChat } = createTranslationWorker({
    reap: (id) => reaped.push(id),
    spawnHiddenChat: (sessionId, prompt) => {
      spawned.push({ sessionId, prompt });
      // The real spawner registers a pending sidebar row for a brand-new session; the
      // worker is expected to drop it again, so the fake has to create one to drop.
      knownSessions.set(sessionId, { createdAt: 0, title: "New session" });
      answer?.(sessionId);
    },
  });
  return { translateViaHiddenChat, reaped, spawned };
}

describe("translateViaHiddenChat", () => {
  it("returns what the worker submits", async () => {
    const h = harness((id) => submitTranslation(id, ["こんにちは", "さようなら"]));
    await expect(h.translateViaHiddenChat("ja", ["hello", "goodbye"])).resolves.toEqual(["こんにちは", "さようなら"]);
  });

  it("seeds the worker with a prompt naming the target language and the inputs", () => {
    const h = harness((id) => submitTranslation(id, ["x"]));
    return h.translateViaHiddenChat("fr", ["hello"]).then(() => {
      expect(h.spawned).toHaveLength(1);
      expect(h.spawned[0].prompt).toContain("fr");
      expect(h.spawned[0].prompt).toContain("hello");
    });
  });

  it("tears the worker down once it is done, whether it succeeded or not", async () => {
    const ok = harness((id) => submitTranslation(id, ["x"]));
    await ok.translateViaHiddenChat("ja", ["hello"]);
    expect(ok.reaped).toEqual([ok.spawned[0].sessionId]);

    // A worker that never submits still has to be cleaned up on the way out.
    const bad = harness((id) => failPendingTranslation(id, "boom"));
    await expect(bad.translateViaHiddenChat("ja", ["hello"])).rejects.toThrow();
    expect(bad.reaped).toHaveLength(bad.spawned.length);
  });

  it("keeps the worker out of the sidebar", async () => {
    // A hidden worker that surfaced as a session row would look like a chat the user
    // never started; the registry marks are what the /api/sessions filter reads.
    let seenWorkerId = "";
    const h = harness((id) => {
      seenWorkerId = id;
      expect(hiddenSessions.has(id)).toBe(true);
      expect(translationWorkerIds.has(id)).toBe(true);
      submitTranslation(id, ["x"]);
    });
    await h.translateViaHiddenChat("ja", ["hello"]);
    expect(knownSessions.has(seenWorkerId)).toBe(false);
    // Teardown drops the marks so they don't accumulate across requests.
    expect(hiddenSessions.has(seenWorkerId)).toBe(false);
    expect(translationWorkerIds.has(seenWorkerId)).toBe(false);
  });

  it("rejects an answer with the wrong number of strings", async () => {
    // A wrong count means the order no longer lines up with the inputs.
    const h = harness((id) => submitTranslation(id, ["only one"]));
    await expect(h.translateViaHiddenChat("ja", ["a", "b"])).rejects.toThrow(/2 inputs/);
  });

  it("rejects a non-array answer, which arrives normalized to an empty list", async () => {
    // submitTranslation substitutes [] for anything that isn't an array, so a junk
    // payload reaches validation as a count mismatch rather than as a bad type.
    const h = harness((id) => submitTranslation(id, "not an array"));
    await expect(h.translateViaHiddenChat("ja", ["a"])).rejects.toThrow(/0 strings for 1 inputs/);
  });

  it("retries a fresh worker and succeeds on a later attempt", async () => {
    let attempt = 0;
    const h = harness((id) => {
      attempt++;
      if (attempt < 3) failPendingTranslation(id, "did not submit");
      else submitTranslation(id, ["ok"]);
    });
    await expect(h.translateViaHiddenChat("ja", ["hello"])).resolves.toEqual(["ok"]);
    expect(h.spawned).toHaveLength(3);
    expect(new Set(h.spawned.map((s) => s.sessionId)).size).toBe(3); // a FRESH worker each time
  });

  it("gives up after the attempt cap rather than retrying forever", async () => {
    const h = harness((id) => failPendingTranslation(id, "did not submit"));
    await expect(h.translateViaHiddenChat("ja", ["hello"])).rejects.toThrow(/did not submit/);
    expect(h.spawned).toHaveLength(3);
  });

  it("surfaces a spawn failure instead of hanging", async () => {
    const { translateViaHiddenChat } = createTranslationWorker({
      reap: () => {},
      spawnHiddenChat: () => {
        throw new Error("claude not on PATH");
      },
    });
    await expect(translateViaHiddenChat("ja", ["hello"])).rejects.toThrow(/claude not on PATH/);
  });

  it("translates an empty batch without spawning a worker that can never answer", async () => {
    const h = harness((id) => submitTranslation(id, []));
    await expect(h.translateViaHiddenChat("ja", [])).resolves.toEqual([]);
  });
});

describe("submitTranslation", () => {
  it("reports false when no request is in flight for that id", () => {
    // The route turns this into a 404 — already settled, timed out, or not a worker.
    expect(submitTranslation("11111111-2222-3333-4444-555555555555", ["x"])).toBe(false);
  });

  it("accepts a duplicate answer, but only the first one decides the result", async () => {
    // The pending entry lives until teardown, so a second submit is still "accepted"
    // (the route answers 200). It cannot change the outcome — the promise is settled.
    const results: boolean[] = [];
    const h = harness((id) => {
      results.push(submitTranslation(id, ["first"]));
      results.push(submitTranslation(id, ["second"]));
    });
    await expect(h.translateViaHiddenChat("ja", ["hello"])).resolves.toEqual(["first"]);
    expect(results).toEqual([true, true]);
  });

  it("substitutes an empty list for a non-array payload, letting validation reject it", async () => {
    const h = harness((id) => submitTranslation(id, { not: "an array" }));
    await expect(h.translateViaHiddenChat("ja", ["a"])).rejects.toThrow();
  });
});

describe("failPendingTranslation", () => {
  it("is a no-op for an id with nothing in flight", () => {
    expect(() => failPendingTranslation("11111111-2222-3333-4444-555555555555", "boom")).not.toThrow();
  });

  it("is a no-op once the worker has already submitted", async () => {
    // The Stop hook fires for every worker, including ones that answered correctly.
    const h = harness((id) => {
      submitTranslation(id, ["done"]);
      failPendingTranslation(id, "ended turn without submitting");
    });
    await expect(h.translateViaHiddenChat("ja", ["hello"])).resolves.toEqual(["done"]);
  });
});
