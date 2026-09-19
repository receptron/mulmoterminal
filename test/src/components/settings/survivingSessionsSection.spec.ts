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
  // The same for `reapable`: absent would read as false and quietly drop the "ends at next start"
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
  it("marks a row the server will end at its next start", async () => {
    serve([row({ reapable: true }), row({ key: "s-2", reapable: false })]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.findAll('[data-testid="surviving-doomed"]')).toHaveLength(1);
  });

  // `reapable` is the server's answer against the OLD threshold, so raising it would otherwise leave
  // rows promising "ends at next start" about a start that will now spare them (CodeRabbit on #1486).
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

  // #2183 pinned the row's wording as independent of the SAVED cadence, because the saved number
  // is not what the running process is doing. #2184 does not undo that — it gives the row the
  // number that IS true: the one the server reports it armed. So the saved value still decides
  // nothing here, and these pin both halves of that.
  it.each([0, 6])("ignores the SAVED cadence when deciding a row's promise (%i)", async (hours) => {
    setSessionReapIntervalHours(hours);
    serve([row({ reapable: true })], 0); // nothing armed, whatever is saved
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.get('[data-testid="surviving-doomed"]').text()).toBe("ends at next start");
  });

  // The armed value is what changes it — a sweep really is scheduled, so the row no longer has to
  // point at a restart that is not the next thing to happen.
  it("promises the next sweep when the SERVER says one is armed", async () => {
    setSessionReapIntervalHours(0); // saved says off; the running server disagrees
    serve([row({ reapable: true })], 6);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.get('[data-testid="surviving-doomed"]').text()).toBe("ends on the next sweep");
    expect(w.text()).toContain("ended on the next sweep");
  });

  // A server that armed a repeat says so in the present tense, because now it is a fact it
  // reported rather than an inference from a number someone typed.
  it("says the cadence is running when saved and armed agree", async () => {
    setSessionReapIntervalHours(6);
    serve([], 6);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.text()).toContain("Repeating every 6 hour(s) in this server");
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

  // A server too old to report it, or a body we could not read, must not produce a promise. OFF
  // understates — the row points at a restart that may come later than the sweep would have — and
  // understating is the only safe direction for a claim about when someone's session disappears.
  it("falls back to no sweep when the server does not say what is armed", async () => {
    setSessionReapIntervalHours(6);
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessions: [row({ reapable: true })] }) })) as unknown as typeof fetch;
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    expect(w.get('[data-testid="surviving-doomed"]').text()).toBe("ends at next start");
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
