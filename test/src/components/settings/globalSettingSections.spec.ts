import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import GitHubSection from "../../../../src/components/settings/GitHubSection.vue";
import SessionSection from "../../../../src/components/settings/SessionSection.vue";
import TerminalFontFamilySection from "../../../../src/components/settings/TerminalFontFamilySection.vue";
import ModelsSection from "../../../../src/components/settings/ModelsSection.vue";
import ToolbarPinsSection from "../../../../src/components/settings/ToolbarPinsSection.vue";
import { setToolbarPins, toolbarPinKeys } from "../../../../src/composables/toolbarPins";
import { MAX_TOOLBAR_PINS } from "../../../../common/toolbarPins";
import type { Shortcut } from "../../../../common/shortcuts";
import { setIssueWorkComments } from "../../../../src/composables/issueWorkComments";
import { setPrWorkdirFooter } from "../../../../src/composables/prWorkdirFooter";
import { setAppendSystemPrompt } from "../../../../src/composables/appendSystemPrompt";
import { setDecisionDigest } from "../../../../src/composables/decisionDigest";
import { setWorklogEnabled, setWorklogIntervalHours } from "../../../../src/composables/worklog";
import { setGlobalFontFamily } from "../../../../src/composables/terminalFontFamily";
import { useAppConfig } from "../../../../src/composables/useAppConfig";
import { reloadLaunchOptions } from "../../../../src/composables/useLaunchOptions";

// The sections that gave a config.json-only setting a control (#1401). What matters about each is
// that flipping it POSTs the RIGHT FIELD: every one is a partial update, so a section naming the
// wrong key writes a setting the user never touched and leaves theirs unchanged — and nothing in
// the UI would show either half of that.

// The pinned favourites the toolbar section lists (#1984) — stubbed, since the real store loads
// them over /api/shortcuts and this file's fetch stub answers every request with the POST echo.
// The stub's list has to be REACTIVE: the section reads it through a computed, and a plain object
// would leave that computed pinned to whatever it saw first — so a test that changes the list
// mid-flight (the refresh window below) would be testing the stub rather than the component.
// The refs live inside the mock factory, which is the only place `vue` can be imported from here.
const pinned = vi.hoisted(
  (): {
    setList: (list: Shortcut[]) => void;
    setError: (error: string | null) => void;
    refreshes: number;
    gate: Promise<void> | null;
    landed: boolean;
  } => ({
    setList: () => {},
    setError: () => {},
    refreshes: 0,
    gate: null,
    landed: true,
  }),
);
vi.mock("../../../../src/composables/useShortcuts", async () => {
  const { computed, ref } = await import("vue");
  const list = ref<Shortcut[]>([]);
  const error = ref<string | null>(null);
  pinned.setList = (next) => (list.value = next);
  pinned.setError = (next) => (error.value = next);
  const load = async (force?: boolean): Promise<boolean> => {
    if (!force) return true;
    pinned.refreshes += 1;
    if (pinned.gate) await pinned.gate;
    return pinned.landed;
  };
  return { useShortcuts: () => ({ shortcuts: computed(() => list.value), loadError: computed(() => error.value), load }) };
});

// The POST bodies, in order. The echo answers with what was sent, which is what the server does.
let posts: Record<string, unknown>[] = [];

beforeEach(() => {
  posts = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const body: Record<string, unknown> = init?.body ? JSON.parse(init.body) : {};
    posts.push(body);
    return { ok: true, json: async () => body };
  }) as unknown as typeof fetch;
});

const toggleAt = async (wrapper: ReturnType<typeof mount>, index: number, checked: boolean) => {
  const box = wrapper.findAll("input[type=checkbox]")[index];
  await box.setValue(checked);
};

describe("GitHubSection", () => {
  beforeEach(() => {
    setIssueWorkComments(true);
    setPrWorkdirFooter(true);
  });

  it("posts issueWorkComments when the work-comment box is unticked", async () => {
    const wrapper = mount(GitHubSection);
    await toggleAt(wrapper, 0, false);
    expect(posts).toEqual([{ issueWorkComments: false }]);
  });

  it("posts prWorkdirFooter when the footer box is unticked", async () => {
    const wrapper = mount(GitHubSection);
    await toggleAt(wrapper, 1, false);
    expect(posts).toEqual([{ prWorkdirFooter: false }]);
  });

  // Normalized before it is stored, not merely before it is judged: the server would reduce a
  // pasted URL to its hostname anyway, so a list showing the raw input would disagree with the
  // config the moment it was saved.
  it("stores a pasted GitLab URL as its hostname", async () => {
    const wrapper = mount(GitHubSection);
    await wrapper.find("input[type=text]").setValue("https://gitlab.example.com/");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Add")
      ?.trigger("click");
    expect(posts).toEqual([{ gitlabHosts: ["gitlab.example.com"] }]);
  });

  it("refuses a host that is not a hostname", async () => {
    const wrapper = mount(GitHubSection);
    await wrapper.find("input[type=text]").setValue("gitlab.example.com/group/project");
    expect(
      wrapper
        .findAll("button")
        .find((b) => b.text() === "Add")
        ?.attributes("disabled"),
    ).toBeDefined();
  });
});

describe("SessionSection", () => {
  beforeEach(() => {
    setAppendSystemPrompt(true);
    setDecisionDigest(false);
    setWorklogEnabled(true);
    setWorklogIntervalHours(6);
  });

  it("posts appendSystemPrompt when the closing-summary box is unticked", async () => {
    const wrapper = mount(SessionSection);
    await toggleAt(wrapper, 0, false);
    expect(posts).toEqual([{ appendSystemPrompt: false }]);
  });

  it("posts decisionDigest when the digest box is ticked", async () => {
    const wrapper = mount(SessionSection);
    await toggleAt(wrapper, 1, true);
    expect(posts).toEqual([{ decisionDigest: true }]);
  });

  it("posts worklogEnabled when the log box is unticked", async () => {
    const wrapper = mount(SessionSection);
    await toggleAt(wrapper, 2, false);
    expect(posts).toEqual([{ worklogEnabled: false }]);
  });

  it("posts the new interval when the stepper is nudged", async () => {
    const wrapper = mount(SessionSection);
    await wrapper
      .findAll("button")
      .find((b) => b.attributes("aria-label") === "Increase dev-work log interval")
      ?.trigger("click");
    expect(posts).toEqual([{ worklogIntervalHours: 7 }]);
  });

  // Greying the row with `pointer-events-none` stops the mouse and nothing else. Without a real
  // `disabled`, a keyboard user tabs into the stepper and saves an interval for a task that is not
  // running — a POST the screen says cannot happen (Codex review on #1412).
  it("cannot change the interval while the log is off", async () => {
    setWorklogEnabled(false);
    const wrapper = mount(SessionSection);
    const up = wrapper.findAll("button").find((b) => b.attributes("aria-label") === "Increase dev-work log interval");
    expect(up?.attributes("disabled")).toBeDefined();
    await up?.trigger("click");
    expect(posts).toEqual([]);
  });

  // The stepper offers the range the SERVER clamps to, so a value it lets the user reach always
  // survives the save. One end is enough to pin that they are the same numbers.
  it("stops at the interval the server clamps to", async () => {
    setWorklogIntervalHours(168);
    const wrapper = mount(SessionSection);
    expect(
      wrapper
        .findAll("button")
        .find((b) => b.attributes("aria-label") === "Increase dev-work log interval")
        ?.attributes("disabled"),
    ).toBeDefined();
  });
});

describe("TerminalFontFamilySection", () => {
  const apply = (w: ReturnType<typeof mount>) => w.findAll("button").find((b) => b.text() === "Apply");

  beforeEach(() => setGlobalFontFamily(null));

  it("posts the normalized stack, with monospace appended", async () => {
    const wrapper = mount(TerminalFontFamilySection);
    await wrapper.find("input").setValue("'Cica'");
    await apply(wrapper)?.trigger("click");
    expect(posts).toEqual([{ fontFamily: "'Cica', monospace" }]);
  });

  it("saves null when the field is cleared, which asks for the built-in stack", async () => {
    setGlobalFontFamily("'Cica', monospace");
    const wrapper = mount(TerminalFontFamilySection);
    await wrapper.find("input").setValue("");
    await apply(wrapper)?.trigger("click");
    expect(posts).toEqual([{ fontFamily: null }]);
  });

  // Without the check this field eats the input in silence: the stack normalizes to null, which
  // SAVES as "use the built-in", and with nothing configured before, the stored value does not
  // change — so nothing re-renders, the text stays in the box, and pressing Apply again does
  // nothing and explains nothing. Found reviewing this PR, not flagged by a bot.
  it("refuses a stack the server would drop, and says why", async () => {
    const wrapper = mount(TerminalFontFamilySection);
    await wrapper.find("input").setValue("Menlo; }");
    expect(apply(wrapper)?.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Not a font stack");
    await apply(wrapper)?.trigger("click");
    expect(posts).toEqual([]);
  });
});

// The draft must survive a config that lands late. /api/config is fetched asynchronously, so the
// modal can open before it arrives, and a plain watch would wipe out whatever had been typed in the
// meantime with no way to get it back (CodeRabbit on #1412).
describe("TerminalFontFamilySection draft", () => {
  beforeEach(() => setGlobalFontFamily(null));

  it("keeps what the user is typing when the config arrives late", async () => {
    const wrapper = mount(TerminalFontFamilySection);
    await wrapper.find("input").setValue("'Cica'");
    setGlobalFontFamily("'Menlo', monospace"); // the load resolving after the modal opened
    await wrapper.vm.$nextTick();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("'Cica'");
  });

  // Untouched, it still has to follow the saved value — otherwise the box shows nothing on a modal
  // opened before the config lands.
  it("adopts the saved value while the box is untouched", async () => {
    const wrapper = mount(TerminalFontFamilySection);
    setGlobalFontFamily("'Menlo', monospace");
    await wrapper.vm.$nextTick();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("'Menlo', monospace");
  });

  // A failed POST is the moment the typed stack matters most: throwing it away leaves the user
  // nothing to retry with, over a dropped request (Codex review on #1416).
  it("keeps the typed stack when the save fails", async () => {
    const wrapper = mount(TerminalFontFamilySection);
    await wrapper.find("input").setValue("'Cica'");
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Apply")
      ?.trigger("click");
    await flushPromises();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("'Cica'");
  });

  // After a save the box is untouched again, so the server's normalized answer — the `monospace` it
  // appended — is what the user is left looking at.
  it("shows the normalized stack the server saved", async () => {
    const wrapper = mount(TerminalFontFamilySection);
    await wrapper.find("input").setValue("'Cica'");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Apply")
      ?.trigger("click");
    await flushPromises();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("'Cica', monospace");
  });
});

// The section claims to show what is configured, and the settings-coverage spec leans on that for
// every display-only setting. It listed providers and only DESCRIBED customAgents, so an agent the
// user had configured was invisible (CodeRabbit on #1412).
describe("ModelsSection", () => {
  it("lists the custom agents the config declares", async () => {
    const { customAgents } = useAppConfig();
    customAgents.value = [{ id: "nemotron", label: "Nemotron", agent: "claude", command: "ollama launch claude --model nemotron --" }];
    const wrapper = mount(ModelsSection);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Nemotron");
    expect(wrapper.text()).toContain("ollama launch claude --model nemotron --");
    customAgents.value = [];
  });

  it("says so when none are configured", async () => {
    const wrapper = mount(ModelsSection);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("None configured");
  });

  // "ready · 0 models" reads like a working backend, and the launch picker leaves it out — which
  // is how #1432 was reported as the picker being broken rather than the config being incomplete.
  it("marks a reachable provider with no models as not being in the picker", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ providers: [{ id: "deepseek", label: "DeepSeek", ready: true, tokenEnv: "DEEPSEEK_API_KEY", models: [] }], anyReady: true }),
    })) as unknown as typeof fetch;
    await reloadLaunchOptions();
    const wrapper = mount(ModelsSection);
    await flushPromises();
    // The provider's own row, not the section's prose: "ready" must not be what this line says.
    const row = wrapper.get("li").text();
    expect(row).toContain("0 models");
    expect(row).toContain("not in the picker");
    expect(row).not.toContain("ready");
  });
});

describe("ToolbarPinsSection", () => {
  const works: Shortcut = { kind: "collection", slug: "works", title: "Work log", icon: "task" };
  const todos: Shortcut = { kind: "collection", slug: "todos", title: "ToDo", icon: "checklist" };

  // Mount AND let the forced re-read land: until it does, the boxes are disabled on purpose, and
  // vue-test-utils will not fire an event on a disabled input — which is the same thing a user
  // clicking early gets.
  const openPane = async () => {
    const wrapper = mount(ToolbarPinsSection);
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    pinned.setList([works, todos]);
    pinned.setError(null);
    pinned.refreshes = 0;
    pinned.gate = null;
    pinned.landed = true;
    setToolbarPins([]);
  });

  it("posts the promoted pin as a toolbarPins key", async () => {
    const wrapper = await openPane();
    await toggleAt(wrapper, 1, true);
    await flushPromises();
    expect(posts).toEqual([{ toolbarPins: ["collection:todos"] }]);
  });

  // The whole list goes every time: the server replaces this key rather than merging into it, so a
  // body carrying only the box just ticked would delete the others.
  it("sends the whole list, keeping the order it already had", async () => {
    setToolbarPins(["collection:todos"]);
    const wrapper = await openPane();
    await toggleAt(wrapper, 0, true);
    await flushPromises();
    expect(posts).toEqual([{ toolbarPins: ["collection:todos", "collection:works"] }]);
  });

  it("posts the remaining ones when a pin is demoted", async () => {
    setToolbarPins(["collection:works", "collection:todos"]);
    const wrapper = await openPane();
    await toggleAt(wrapper, 0, false);
    await flushPromises();
    expect(posts).toEqual([{ toolbarPins: ["collection:todos"] }]);
  });

  // Codex on #1991: each save used to build its list from the last CONFIRMED one, so two boxes
  // ticked before the first response landed both started from [] and the second write dropped the
  // first. The mutation is queued and re-resolved when it runs, so both survive.
  it("keeps both when two boxes are ticked before the first save lands", async () => {
    const wrapper = await openPane();
    const boxes = wrapper.findAll("input[type=checkbox]");
    await Promise.all([boxes[0].setValue(true), boxes[1].setValue(true)]);
    await flushPromises();
    expect(posts).toEqual([{ toolbarPins: ["collection:works"] }, { toolbarPins: ["collection:works", "collection:todos"] }]);
    expect(toolbarPinKeys.value).toEqual(["collection:works", "collection:todos"]);
  });

  // At the cap the box cannot be ticked at all, so the refusal is visible rather than a silent
  // no-op the user reads as a failed save.
  it("disables what it cannot promote once the cap is full", async () => {
    const many: Shortcut[] = Array.from({ length: MAX_TOOLBAR_PINS + 1 }, (_, i) => ({ kind: "collection", slug: `c${i}`, title: `C${i}`, icon: "task" }));
    pinned.setList(many);
    setToolbarPins(many.slice(0, MAX_TOOLBAR_PINS).map((pin) => `collection:${pin.slug}`));
    const wrapper = await openPane();
    const boxes = wrapper.findAll("input[type=checkbox]");
    expect(boxes[MAX_TOOLBAR_PINS].attributes("disabled")).toBeDefined();
    // ...while the promoted ones stay enabled: being at the cap is what makes removing one useful.
    expect(boxes[0].attributes("disabled")).toBeUndefined();
  });

  // Codex on #1991: keys whose pins are gone are not offered here, so counting them toward the cap
  // would lock the section with nothing on screen to untick — and the first save clears them out.
  it("does not let vanished pins fill the cap", async () => {
    setToolbarPins(Array.from({ length: MAX_TOOLBAR_PINS }, (_, i) => `collection:gone${i}`));
    const wrapper = await openPane();
    expect(wrapper.findAll("input[type=checkbox]")[0].attributes("disabled")).toBeUndefined();
    await toggleAt(wrapper, 0, true);
    await flushPromises();
    expect(posts).toEqual([{ toolbarPins: ["collection:works"] }]);
  });

  // A refused save must not leave the screen showing a state the host never took.
  it("puts the box back when the save fails", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const wrapper = await openPane();
    await toggleAt(wrapper, 0, true);
    await flushPromises();
    expect(toolbarPinKeys.value).toEqual([]);
    const box = wrapper.findAll("input[type=checkbox]")[0];
    expect(box.element instanceof HTMLInputElement && box.element.checked).toBe(false);
  });

  // Codex on #1991: the store caches its first successful read for the life of the page, and the
  // file is shared with MulmoClaude — so what this pane offers, and the prune it applies on save,
  // would both judge from a list that can be hours old.
  it("re-reads the pinned list when the pane opens", () => {
    mount(ToolbarPinsSection);
    expect(pinned.refreshes).toBe(1);
  });

  // Codex on #1991 (P1): the forced read leaves a window where the rows on screen are the OLD list.
  // A tick in that window would carry it into the prune and persist a preference with the entries
  // the refresh was about to bring back stripped out. The pane must not be actable until it lands.
  it("cannot be saved from while the forced re-read is in flight", async () => {
    let open: () => void = () => {};
    pinned.gate = new Promise<void>((resolve) => (open = resolve));
    // Promoted, but absent from the list this page has been holding — exactly what a stale prune eats.
    pinned.setList([works]);
    setToolbarPins(["collection:todos"]);
    const wrapper = mount(ToolbarPinsSection);
    await flushPromises();
    expect(wrapper.findAll("input[type=checkbox]")[0].attributes("disabled")).toBeDefined();

    pinned.setList([works, todos]); // what the re-read brings back
    open();
    await flushPromises();
    expect(wrapper.findAll("input[type=checkbox]")[0].attributes("disabled")).toBeUndefined();

    await toggleAt(wrapper, 0, true);
    await flushPromises();
    expect(posts).toEqual([{ toolbarPins: ["collection:todos", "collection:works"] }]);
  });

  // Codex on #1991 (P1), the third finding on one rule: a forced read that FAILS leaves the cached
  // list on screen, and saving from it prunes every configured key that list happens to lack. So a
  // read that did not land leaves the pane read-only rather than merely un-refreshed.
  it("stays read-only when the forced re-read fails, and says why", async () => {
    pinned.landed = false;
    pinned.setError("HTTP 500");
    setToolbarPins(["collection:todos"]);
    const wrapper = await openPane();
    expect(wrapper.text()).toContain("could not be re-read");
    for (const box of wrapper.findAll("input[type=checkbox]")) expect(box.attributes("disabled")).toBeDefined();
    // ...and nothing reaches the config even if a change is forced through the DOM.
    await toggleAt(wrapper, 0, true);
    await flushPromises();
    expect(posts).toEqual([]);
    expect(toolbarPinKeys.value).toEqual(["collection:todos"]);
  });

  it("says what to do when nothing is pinned at all", () => {
    pinned.setList([]);
    expect(mount(ToolbarPinsSection).text()).toContain("Nothing is pinned yet");
  });

  // ...and does NOT say it when the list is empty because something failed: "go and pin something
  // first" is advice that cannot be followed, and it hides the reason the pane is empty. Observed
  // during Claude review, not flagged by a bot.
  it("tells an unavailable list apart from an empty one", () => {
    pinned.setList([]);
    pinned.setError("HTTP 500");
    const text = mount(ToolbarPinsSection).text();
    expect(text).toContain("HTTP 500");
    expect(text).not.toContain("Nothing is pinned yet");
  });

  // Codex on #1991: `loadError` is also what a FAILED PIN/UNPIN sets (`persist` in useShortcuts),
  // and that leaves the list loaded. Reporting it here would describe neither the cause nor what is
  // on screen — the rows are right there and still tickable.
  it("stays quiet about an error that left the list on screen", async () => {
    pinned.setError("HTTP 500");
    const wrapper = await openPane();
    expect(wrapper.findAll("input[type=checkbox]")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("HTTP 500");
    // ...and the pane still works: promoting from here writes toolbarPins, not shortcuts.
    await toggleAt(wrapper, 0, true);
    await flushPromises();
    expect(posts).toEqual([{ toolbarPins: ["collection:works"] }]);
  });
});
