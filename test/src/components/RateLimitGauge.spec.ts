import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RateLimitGauge from "../../../src/components/RateLimitGauge.vue";

// The note only reaches a user through the template, and the pure function that produces it can be
// green while nothing renders it. #1011's whole point is that an absent Claude gauge must say why,
// so the wiring is what needs pinning here.

const body = (over: Record<string, unknown>) => ({ claude: null, codex: null, probing: false, ...over });

const serve = (payload: Record<string, unknown>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
};

const showGauge = async (payload: Record<string, unknown>) => {
  serve(payload);
  const wrapper = mount(RateLimitGauge);
  await flushPromises();
  return wrapper;
};

const note = (wrapper: Awaited<ReturnType<typeof showGauge>>) => wrapper.find('[data-testid="rate-limit-note"]');

// Relative to now, not a fixed epoch: a hard-coded timestamp silently becomes a PAST reset as the
// clock moves on, and a window whose reset has gone by is deliberately not rendered any more.
const inHours = (h: number) => Math.floor(Date.now() / 1000) + h * 3600;
const limits = { fiveHour: { usedPercentage: 12, resetsAt_sec: inHours(2) }, sevenDay: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RateLimitGauge", () => {
  it("says why the Claude half is missing, with the reason on hover", async () => {
    const wrapper = await showGauge(body({ claudeProbe: "no-claude" }));
    expect(note(wrapper).text()).toBe("claude usage n/a");
    expect(note(wrapper).attributes("data-tip")).toContain("not found on PATH");
    wrapper.unmount();
  });

  it("names the API-key case and the retrying case differently", async () => {
    const noWindows = await showGauge(body({ claudeProbe: "no-windows" }));
    expect(noWindows.get('[data-testid="rate-limit-note"]').attributes("data-tip")).toContain("API-key billing");
    noWindows.unmount();

    const noReport = await showGauge(body({ claudeProbe: "no-report" }));
    expect(noReport.get('[data-testid="rate-limit-note"]').attributes("data-tip")).toContain("Retrying");
    noReport.unmount();
  });

  it("stays silent when nothing has been measured yet, rather than inventing a fault", async () => {
    const wrapper = await showGauge(body({ claudeProbe: "ok" }));
    expect(note(wrapper).exists()).toBe(false);
    wrapper.unmount();
  });

  it("drops the note once the figures arrive", async () => {
    const wrapper = await showGauge(body({ claude: limits, claudeProbe: "ok" }));
    expect(note(wrapper).exists()).toBe(false);
    expect(wrapper.text()).toContain("5h");
    wrapper.unmount();
  });

  // The gap the note was written for and did not cover: a cached reading outlives its window, so
  // uninstalling `claude` used to leave yesterday's percentage on screen saying nothing.
  it("replaces a figure whose window has already reset with the reason", async () => {
    const stale = { fiveHour: { usedPercentage: 83, resetsAt_sec: inHours(-1) }, sevenDay: null };
    const wrapper = await showGauge(body({ claude: stale, claudeProbe: "no-claude" }));

    expect(wrapper.text()).not.toContain("83");
    expect(note(wrapper).attributes("data-tip")).toContain("not found on PATH");
    wrapper.unmount();
  });

  // Codex review on #1047: hiding the row is only half of it. The row carries an aria-label, and a
  // screen reader announcing a percentage that is not on screen is worse than one announcing none.
  it("does not announce a percentage it has stopped showing", async () => {
    const half = { fiveHour: { usedPercentage: 83, resetsAt_sec: inHours(-1) }, sevenDay: { usedPercentage: 40, resetsAt_sec: inHours(9) } };
    const wrapper = await showGauge(body({ claude: half, claudeProbe: "ok" }));

    const spoken = wrapper.findAll("[aria-label]").map((el) => el.attributes("aria-label") ?? "");
    expect(spoken.join(" ")).toContain("7d 40% used");
    expect(spoken.join(" ")).not.toContain("83");
    expect(wrapper.text()).not.toContain("83");
    wrapper.unmount();
  });

  // #1161, as reported: `claude usage n/a | 7d 71%`. The 71% is Codex's — the note only appears
  // when Claude has nothing — but nothing on the row said so, and it was read as Claude's 7d with
  // the 5h missing. Whether a figure belongs to the tool beside it is not something a reader can
  // work out, so this pins the MARK reaching the screen and not merely the flag.
  it("says whose the surviving figure is when a note stands in for the other", async () => {
    const codex = { fiveHour: null, sevenDay: { usedPercentage: 71, resetsAt_sec: inHours(50) } };
    const wrapper = await showGauge(body({ codex, claudeProbe: "no-report" }));

    expect(note(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain("7d 71%");
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toContain("codex rate limit");
    expect(wrapper.findComponent({ name: "AgentMark" }).props("agent")).toBe("codex");
    wrapper.unmount();
  });

  // #2215: a claude account whose check is stuck says so under its own name.
  it("names a stuck account instead of leaving it out", async () => {
    const accounts = [{ id: "work", label: "Work", agent: "claude", limits: null, probing: false, probe: "no-report", probeStall: "trust-prompt" }];
    const wrapper = await showGauge(body({ claude: limits, accounts }));
    const entry = wrapper.get('[data-testid="rate-limit-account-note"]');
    expect(entry.text()).toContain("Work");
    expect(entry.attributes("data-tip")).toContain("trust prompt");
    expect(note(wrapper).exists()).toBe(false);
  });
});

// #2995, as reported: `a n/a | 5h 2% 7d 0% | b 5h 2% 7d 0%`, with a out of its week. The reader
// has to see that a is OUT, not unknown, and which of the two identical figures is the /login one.
describe("RateLimitGauge beside rotation tokens", () => {
  it("draws an at-limit token in the warning colour and names the /login figures", async () => {
    const lastLimits = { fiveHour: null, sevenDay: { usedPercentage: 100, resetsAt_sec: inHours(70) } };
    const accounts = [
      { id: "a", label: "a", agent: "claude", limits: null, probing: false, probe: "no-report", probeStall: "usage-limit", lastLimits, rotation: true },
      { id: "b", label: "b", agent: "claude", limits, probing: false, probe: "ok", rotation: true },
    ];
    const wrapper = await showGauge(body({ claude: limits, accounts }));

    const out = wrapper.get('[data-testid="rate-limit-account-note"]');
    expect(out.text()).toContain("at limit");
    expect(out.text()).not.toContain("n/a");
    expect(out.classes()).toContain("text-amber");
    expect(out.attributes("data-tip")).toMatch(/usage limit.*7d resets in/);
    // The same text is the accessible name, so a screen reader hears the reset without a mouse.
    expect(out.attributes("aria-label")).toBe(out.attributes("data-tip"));

    // Whitespace between the label and the figures is flex gap, not text, so the spans are read one by one.
    const named = wrapper.findAll('[role="img"]').map((gauge) =>
      gauge
        .findAll("span")
        .map((part) => part.text())
        .join(" "),
    );
    expect(named).toEqual(["/login 5h 12%", "b 5h 12%"]);
    expect(wrapper.findAll('[data-testid="rate-limit-account"]')).toHaveLength(1);
    wrapper.unmount();
  });
});
