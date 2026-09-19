import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import SurvivingSessionsSection from "../../../../src/components/settings/SurvivingSessionsSection.vue";
import { setSessionIdleReapDays, setSessionReapIntervalHours } from "../../../../src/composables/sessionReap";
import { DEFAULT_REAP_IDLE_DAYS, DEFAULT_REAP_INTERVAL_HOURS, REAP_IDLE_DAYS_OFF } from "../../../../common/sessionReap";
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

const serve = (sessions: unknown) => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessions }) })) as unknown as typeof fetch;
};

const posts = (): string[] => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

// The two reap numbers live in module state, so a test that raises one would otherwise hand it to
// the next test. Back to the shipped defaults before each.
beforeEach(() => {
  vi.restoreAllMocks();
  serve([]);
  setSessionIdleReapDays(DEFAULT_REAP_IDLE_DAYS);
  setSessionReapIntervalHours(DEFAULT_REAP_INTERVAL_HOURS);
});

const bodies = (): string[] =>
  (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String((c[1] as { body?: string } | undefined)?.body ?? ""));

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

  // #2177. The row deliberately does NOT change with the interval, and this pins that rather than
  // leaving it to be "fixed" later: `startReapSchedule` arms the timer once from the value read at
  // boot, so a session whose interval was raised in Settings and never restarted is still ended at
  // the next start. A badge switching on the saved value would be a new false sentence — the exact
  // defect this issue is about — and saying it truthfully needs the server to report what it armed.
  it("keeps the row's wording on the next start even when an interval is saved", async () => {
    setSessionReapIntervalHours(6);
    serve([row({ reapable: true })]);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const badge = w.get('[data-testid="surviving-doomed"]');
    expect(badge.text()).toBe("ends at next start");
    expect(badge.attributes("title")).toContain("at its next start");
    expect(w.text()).toContain("ended when the server next starts");
  });

  it("writes the sweep interval to its own config field", async () => {
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    await w.get('[aria-label="Increase the hours between sweeps while the server is up"]').trigger("click");
    await flushPromises();
    expect(bodies().some((b) => b.includes("sessionReapIntervalHours"))).toBe(true);
  });

  // The interval decides nothing while the threshold is 0, and `pointer-events-none` on the
  // container stops the mouse only — a keyboard user would still tab in and save a number the
  // screen calls unavailable.
  it("disables the interval stepper, and writes nothing, while sessions are never ended", async () => {
    setSessionIdleReapDays(REAP_IDLE_DAYS_OFF);
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const plus = w.get('[aria-label="Increase the hours between sweeps while the server is up"]');
    expect(plus.attributes("disabled")).toBeDefined();
    await plus.trigger("click");
    await flushPromises();
    expect(bodies().some((b) => b.includes("sessionReapIntervalHours"))).toBe(false);
  });

  it("says which of the three states the interval is in", async () => {
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const hint = () => w.get('[data-testid="surviving-interval-hint"]').text();
    expect(hint()).toBe("Only at server start.");

    // Says WHEN it starts applying, because the timer is armed at boot and not on save.
    setSessionReapIntervalHours(6);
    await flushPromises();
    expect(hint()).toBe("From the next server start, also every 6 hour(s).");

    setSessionIdleReapDays(REAP_IDLE_DAYS_OFF);
    await flushPromises();
    expect(hint()).toContain("Nothing to repeat");
  });

  // Raising the interval changes only what the rows SAY. Which rows the sweep takes is the
  // threshold's question and the server already answered it, so re-reading the list here would be
  // a request that can return nothing new.
  it("does not re-read the list when only the interval changes", async () => {
    const w = mount(SurvivingSessionsSection);
    await flushPromises();
    const listReads = () =>
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes("/api/tmux/sessions")).length;
    const before = listReads();
    await w.get('[aria-label="Increase the hours between sweeps while the server is up"]').trigger("click");
    await flushPromises();
    expect(listReads()).toBe(before);
  });
});
