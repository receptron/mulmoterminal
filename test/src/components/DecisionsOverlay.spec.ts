import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import type { DecisionQuestion, DecisionsResponse } from "../../../common/decisionLog";
import DecisionsOverlay from "../../../src/components/DecisionsOverlay.vue";

// Wiring only — which rows exist, what a filter keeps and what an empty answer means live in
// src/components/decisionRows.ts and are tested there without mounting.
vi.mock("../../../src/composables/useDecisionsView", () => ({
  useDecisionsView: () => ({ isOpen: ref(true), cwd: ref("/home/dev/project"), close: vi.fn() }),
}));
vi.mock("../../../src/composables/useAppConfig", () => ({
  useAppConfig: () => ({ defaultCwd: ref("/home/dev/workspace") }),
}));

let lastUrl = "";

function mockFetch(body: DecisionsResponse, ok = true): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    lastUrl = String(input);
    return { ok, status: ok ? 200 : 500, json: async () => body };
  }) as unknown as typeof fetch;
}

const question = (over: Partial<DecisionQuestion> = {}): DecisionQuestion => ({
  question: "どう進めますか？",
  header: "進め方",
  multiSelect: false,
  options: [{ label: "今すぐ実装する", description: "ブランチを切って着手" }],
  answer: "今すぐ実装する",
  answerKind: "option",
  ...over,
});

const answer = (questions: DecisionQuestion[], over: Partial<DecisionsResponse> = {}): DecisionsResponse => ({
  decisions: [{ sessionId: "s1", cwd: "/home/dev/project", ts: new Date().toISOString(), toolUseId: "toolu_1", questions }],
  scanned: 4,
  unreadable: 0,
  ...over,
});

describe("DecisionsOverlay", () => {
  it("asks the API for the route's project and renders the question, its options and the answer", async () => {
    mockFetch(answer([question()]));
    const w = mount(DecisionsOverlay);
    await flushPromises();
    expect(lastUrl).toBe(`/api/decisions?cwd=${encodeURIComponent("/home/dev/project")}`);
    const text = w.text();
    expect(text).toContain("どう進めますか？");
    expect(text).toContain("今すぐ実装する");
    expect(text).toContain("ブランチを切って着手"); // the description — what the other branch would have been
    expect(text).toContain("chose an option");
  });

  it("filters to the answers the user wrote themselves", async () => {
    mockFetch(answer([question(), question({ question: "本当に？", answer: "いや、その前に", answerKind: "free-text" })]));
    const w = mount(DecisionsOverlay);
    await flushPromises();
    expect(w.text()).toContain("どう進めますか？");

    const wroteTheirOwn = w.findAll("button").find((b) => b.text().startsWith("Wrote their own"));
    expect(wroteTheirOwn?.text()).toContain("1");
    await wroteTheirOwn?.trigger("click");
    expect(w.text()).toContain("本当に？");
    expect(w.text()).not.toContain("どう進めますか？");
  });

  it("says an incomplete scan is incomplete instead of showing a short list as the whole truth", async () => {
    mockFetch(answer([question()], { unreadable: 2 }));
    const w = mount(DecisionsOverlay);
    await flushPromises();
    expect(w.text()).toContain("2 transcripts could not be read");
  });

  it("distinguishes a project with no sessions from one that was never asked anything", async () => {
    mockFetch({ decisions: [], scanned: 0, unreadable: 0 });
    const empty = mount(DecisionsOverlay);
    await flushPromises();
    expect(empty.text()).toContain("No sessions in this project yet.");

    mockFetch({ decisions: [], scanned: 9, unreadable: 0 });
    const quiet = mount(DecisionsOverlay);
    await flushPromises();
    expect(quiet.text()).toContain("Nothing was asked in this project's 9 sessions.");
  });

  it("reports a failed request rather than rendering it as an empty log", async () => {
    mockFetch({ decisions: [], scanned: 0, unreadable: 0 }, false);
    const w = mount(DecisionsOverlay);
    await flushPromises();
    expect(w.text()).toContain("Could not read decisions");
  });
});
