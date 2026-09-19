import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import SurvivingSessionsSection from "../../../../src/components/settings/SurvivingSessionsSection.vue";
import { setSessionIdleReapDays, setSessionReapIntervalHours } from "../../../../src/composables/sessionReap";
import type { SurvivingSession } from "../../../../common/survivingSessions";

// The one screen that reaches a session left behind by a restart in a directory you no longer open
// (#1478). What matters is that a row can be ACTED on: the stop button posts that row's own key,
// and never appears for a session a terminal is holding.
const row = (over: Partial<SurvivingSession> = {}): SurvivingSession => ({
  key: "s-1",
  cwd: "/repo",
  agent: "claude",
  idleSeconds: 7200,
  attached: false,
  resumable: true,
  reapable: false,
  ...over,
});

// `armed` is what the SERVER reports it started, which is NOT the saved config: the timer is armed
// once at boot and not re-armed on a POST, so the two disagree from a save until the next restart
// (#2184). Every row promise below is decided from this one.
const serve = (sessions: unknown, armed = 0) => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessions, armedReapIntervalHours: armed }) })) as unknown as typeof fetch;
};

const posts = (): string[] => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

// Module singletons, so a test that changes one leaks into the next unless it is reset here. The
// defaults are the shipped ones: the threshold on, the repeat OFF (#2167).
beforeEach(() => {
  vi.restoreAllMocks();
  serve([]);
  setSessionIdleReapDays(7);
  setSessionReapIntervalHours(0);
});

describe("the surviving-sessions section", () => {
  it("says so when nothing survived, rather than showing an empty box", async () => {
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("None");
    expect(w.findAll('[data-testid="surviving-row"]')).toHaveLength(0);
  });

  it("lists a survivor with its directory, what it is, and how long it has been sitting", async () => {
    serve([row()]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const text = w.get('[data-testid="surviving-row"]').text();
    expect(text).toContain("/repo");
    expect(text).toContain("claude");
    expect(text).toContain("last active 2h ago");
  });

  // A shell left behind by a restart appears in no other list in the app, so this one has to name
  // it rather than show a blank where the agent would be — while stopping short of CALLING it a
  // shell, since an agy/grok session that outlived its pty reaches here the same way.
  it("names a session no agent claims, and warns that nothing can resume it", async () => {
    serve([row({ agent: null, resumable: false, cwd: null })]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const text = w.get('[data-testid="surviving-row"]').text();
    expect(text).toContain("shell or unknown");
    expect(text).toContain("unknown directory");
    expect(w.find('[data-testid="surviving-only-copy"]').exists()).toBe(true);
  });

  it("stops the row's own session, then re-reads the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    serve([row({ key: "mt-key-9" })]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    await w.get('[data-testid="surviving-stop"]').trigger("click");
    await flushPromises();
    expect(posts()).toContain("/api/session/mt-key-9/terminate");
    // Twice on /api/tmux/sessions: the mount, and the reload the stop triggers.
    expect(posts().filter((u) => u.includes("/api/tmux/sessions"))).toHaveLength(2);
  });

  // Held by a terminal: that window's own close button owns it, and ending it from Settings would
  // pull a session out from under a tab this screen cannot see (the rule #1474 set).
  it("offers no stop for a session a terminal is holding", async () => {
    serve([row({ attached: true })]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.find('[data-testid="surviving-open"]').exists()).toBe(true);
    expect(w.find('[data-testid="surviving-stop"]').exists()).toBe(false);
  });

  // A row missing the key is a stop button with nothing to post to — dropped before it is drawn.
  // The same for `reapable`: absent would read as false and quietly drop the due-to-be-ended
  // mark from a row the server is about to end (Codex on #1486).
  it.each([
    ["no key", { cwd: "/repo", attached: false }],
    ["no reapable", { key: "s-2", cwd: "/repo", agent: null, idleSeconds: 1, attached: false, resumable: true }],
  ])("drops a row the server sent malformed (%s)", async (_name, bad) => {
    serve([bad, row()]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.findAll('[data-testid="surviving-row"]')).toHaveLength(1);
  });

  // The sweep acts without being asked, so the rows it will take say so before it happens (#1467).
  it("marks a row the next sweep will end", async () => {
    serve([row({ reapable: true }), row({ key: "s-2", reapable: false })]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.findAll('[data-testid="surviving-doomed"]')).toHaveLength(1);
  });

  // `reapable` is the server's answer against the OLD threshold, so raising it would otherwise leave
  // rows marked due-to-be-ended by a sweep that will now spare them (CodeRabbit on #1486).
  it("re-reads the rows after the threshold changes", async () => {
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const listReads = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes("/api/tmux/sessions")).length;
    const before = listReads();
    await w.get('[aria-label="Increase the idle days before a session is ended"]').trigger("click");
    await flushPromises();
    expect(listReads()).toBe(before + 1);
  });

  it("writes the idle threshold to its own config field", async () => {
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    await w.get('[aria-label="Increase the idle days before a session is ended"]').trigger("click");
    await flushPromises();
    const post = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => c[1] as { body?: string } | undefined)
      .find((init) => init?.body?.includes("sessionIdleReapDays"));
    expect(post?.body).toContain("sessionIdleReapDays");
  });

  // The cadence had no control at all until now: default 0 means the feature does nothing until
  // someone edits config.json, and a setting whose default is "does nothing" is one nobody finds.
  it("writes the sweep cadence to its own config field", async () => {
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    await w.get('[aria-label="Increase how often the sweep repeats"]').trigger("click");
    await flushPromises();
    const bodies = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => (c[1] as { body?: string } | undefined)?.body);
    expect(bodies.some((b) => b?.includes("sessionReapIntervalHours"))).toBe(true);
    // The cadence does not change WHICH rows are reapable, so it must not trigger the re-read the
    // threshold does — that reload exists to correct `reapable`, and nothing here invalidates it.
    expect(bodies.filter((b) => b?.includes("sessionIdleReapDays"))).toHaveLength(0);
  });

  // The row's promise is INDEPENDENT of any cadence, saved or armed, and this pins it so nobody
  // re-derives the obvious-looking wording. The row names the EVENT — "the next sweep ends it" —
  // which is true in every reachable state, and #2184 does not change that: knowing the armed
  // cadence makes the HINT able to speak in the present tense, not the row (#2189).
  it.each([0, 6])("names the sweep rather than a clock, whatever the saved cadence is (%i)", async (hours) => {
    setSessionReapIntervalHours(hours);
    serve([row({ reapable: true })], 0); // nothing armed, whatever is saved
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const badge = w.get('[data-testid="surviving-doomed"]');
    expect(badge.text()).toBe("due to be ended");
    expect(badge.attributes("title")).toContain("the next sweep ends it");
    expect(w.text()).not.toContain("next start");
  });

  // Same reason, on the hint under the threshold stepper.
  it.each([0, 6])("keeps the threshold hint on the event whatever the saved cadence is (%i)", async (hours) => {
    setSessionReapIntervalHours(hours);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("ended by the next sweep");
    expect(w.text()).not.toContain("ended when the server next starts");
  });

  // What #2184 changes, and the ONLY thing it changes: the browser is now told the cadence the
  // server armed, so the hint can stop hedging. #2189 had to write "Saved: …" because the armed
  // value was not on the wire; with it, saved-and-armed-agree is a fact worth stating plainly.
  it("states the running cadence as a fact when saved and armed agree", async () => {
    setSessionReapIntervalHours(6);
    serve([], 6);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("Repeating every 6 hour(s).");
  });

  // The window this whole change exists for: the number was saved, nothing re-armed, and the
  // person who just changed it would otherwise watch it do nothing with no explanation.
  it("says a saved cadence has not started yet, and what is running until it does", async () => {
    setSessionReapIntervalHours(6);
    serve([], 0);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("starts repeating at the next server start");
    expect(w.text()).toContain("sweeps only at start");
  });

  it("names the cadence still running while a different one waits for a restart", async () => {
    setSessionReapIntervalHours(2);
    serve([], 6);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("starts repeating at the next server start");
    expect(w.text()).toContain("keeps sweeping every 6 hour(s)");
  });

  // A server too old to report it, or a body we could not read, must not produce a present-tense
  // claim. Falling back to OFF makes the hint say the value is merely saved — the hedge #2189
  // used everywhere — which is the safe direction when we cannot know.
  it("falls back to the saved-value wording when the server does not say what is armed", async () => {
    setSessionReapIntervalHours(6);
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [row({ reapable: true })] }) })) as unknown as typeof fetch;
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("starts repeating at the next server start");
    expect(w.text()).not.toContain("Repeating every 6 hour(s).");
  });

  // Shown in EVERY state, including the disabled one: "when does this apply" is what the
  // saved-value wording leaves open, so it must not be the line that goes missing.
  it.each([
    ["no cadence", 7, 0],
    ["a cadence saved", 7, 6],
    ["the sweep off entirely", 0, 6],
  ])("always says when a cadence change is read — %s", async (_label, days, hours) => {
    setSessionIdleReapDays(days);
    setSessionReapIntervalHours(hours);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.get('[data-testid="surviving-sweep-note"]').text()).toBe(
      "The cadence is read when the server starts, so a change here applies from the next one.",
    );
  });

  // Turning the threshold off turns the whole sweep off, so a cadence promising a repeat would
  // contradict the row directly above it — the row that just said "never".
  it("does not offer a cadence when the sweep itself is off", async () => {
    setSessionIdleReapDays(0);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("nothing for this to repeat");
    expect(w.get('[aria-label="Increase how often the sweep repeats"]').attributes("disabled")).toBeDefined();
  });

  it("says the list could not be read instead of claiming there is nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("Could not read them");
    expect(w.text()).not.toContain("None —");
  });
});
