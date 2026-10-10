import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SettingsModal from "../../../src/components/SettingsModal.vue";
import SkillLaunchButton from "../../../src/components/SkillLaunchButton.vue";
import { SETTINGS_GROUPS, SETTINGS_TABS, DEFAULT_SETTINGS_TAB, type SettingsTabId } from "../../../src/components/settings/settingsTabs";
import { VOICE_LANGUAGES } from "../../../src/composables/voiceLanguage";
import { useTheme } from "../../../src/composables/useTheme";
import { BUNDLED_SKILL_NAMES } from "../../../common/bundledSkills";
import { i18n } from "../../../src/i18n";
import { en } from "../../../src/i18n/en";
import { launchAgent } from "../../../src/composables/useChatLauncher";
import { UI_LOCALES } from "../../../src/composables/uiLanguage";
import { closeSettings, openSettingsAt, requestedSettingsTab, settingsOpen } from "../../../src/composables/settingsOpener";

const filesOpened = vi.hoisted(() => [] as [string | null, string][]);
const helpOpened = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../src/components/helpChat", () => ({
  HELP_SKILL: "mulmoterminal-help",
  openHelpChat: async () => {
    helpOpened.count += 1;
    return null;
  },
}));
vi.mock("../../../src/composables/useFilesView", () => ({
  filesGotoFile: (cwd: string | null, path: string) => {
    filesOpened.push([cwd, path]);
  },
}));

// The sidebar's words come from the message tree now, keyed by the table's ids.
const tabLabel = (tab: SettingsTabId): string => i18n.global.t(`settings.tabs.${tab}`);

type Wrapper = ReturnType<typeof mount>;

const mountModal = (props: Record<string, unknown> = {}) => mount(SettingsModal, { props });

// The sidebar shows one section at a time (#1563), so a test about a setting has to say which tab
// it lives on. Anything that doesn't is about the Theme pane the modal opens on.
async function openTab(w: Wrapper, tab: SettingsTabId): Promise<Wrapper> {
  const button = w.find(`[data-testid="settings-tab-${tab}"]`);
  if (!button.exists()) throw new Error(`no Settings tab "${tab}" in the sidebar`);
  await button.trigger("click");
  return w;
}

const mountTab = async (tab: SettingsTabId, props: Record<string, unknown> = {}) => openTab(mountModal(props), tab);

const renderedTabs = (w: Wrapper): string[] =>
  w.findAll("[data-testid^='settings-tab-']").map((b) => (b.attributes("data-testid") ?? "").replace("settings-tab-", ""));

function clickBtn(w: Wrapper, match: (text: string) => boolean) {
  const btn = w.findAll("button").find((b) => match(b.text()));
  if (!btn) throw new Error("button not found");
  return btn.trigger("click");
}

// Every GET the panes fire on mount resolves to a body they tolerate; the voice probe decides
// whether the Voice input tab is offered at all.
const stubServer = (voiceCapable: boolean) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url === "/api/transcribe/model"
        ? { ok: true, json: async () => ({ capable: voiceCapable, model: { name: "base", state: "ready" } }) }
        : { ok: true, json: async () => ({}) },
    ),
  );

// The sidebar is a hand-written table, and a table drifts from what it claims to index in silence:
// a tab whose pane was never wired renders an empty box, and a pane no group lists is unreachable
// with nothing failing anywhere.
describe("SettingsModal sidebar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers every tab the table declares, in group order", async () => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    expect(renderedTabs(w)).toEqual([...SETTINGS_TABS]);
  });

  it("renders a pane for each of them", async () => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    for (const tab of SETTINGS_TABS) {
      await openTab(w, tab);
      await flushPromises();
      const pane = w.get('[data-testid="settings-pane"]');
      // The heading is always there; anything beyond it is the section that tab is for.
      expect(pane.element.children.length, `the "${tab}" tab rendered no section`).toBeGreaterThan(1);
      expect(pane.text()).toContain(tabLabel(tab));
    }
  });

  it("opens on a tab that exists, and gives every group tabs", () => {
    expect(SETTINGS_TABS).toContain(DEFAULT_SETTINGS_TAB);
    expect(SETTINGS_GROUPS.every((group) => group.tabs.length > 0)).toBe(true);
  });

  // A tab or group whose message was never written renders its own key — visible only to whoever
  // opens that pane in that language, which is exactly the person who can't read the fallback.
  // Enumerated from the table rather than from a list typed here (the lesson of #1104).
  it.each(UI_LOCALES.map((locale) => locale.code))("names every group and tab in %s", (locale) => {
    const missing: string[] = [];
    const check = (key: string) => {
      if (!i18n.global.te(key, locale)) missing.push(key);
    };
    SETTINGS_GROUPS.forEach((group) => check(`settings.groups.${group.key}`));
    SETTINGS_TABS.forEach((tab) => check(`settings.tabs.${tab}`));
    expect(missing).toEqual([]);
  });

  // The narrow-screen picker is a second control over the same state, so it has to offer the same
  // sections — and actually switch the pane. A phone gets ~190px of pane beside the sidebar, which
  // is where the sound rows lose their labels off the edge.
  it("offers the same sections in the narrow-screen picker, grouped, and switches on a pick", async () => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    const picker = w.get('select[aria-label="Settings section"]');
    expect(picker.findAll("option").map((o) => o.attributes("value"))).toEqual([...SETTINGS_TABS]);
    expect(picker.findAll("optgroup").map((g) => g.attributes("label"))).toEqual(SETTINGS_GROUPS.map((group) => i18n.global.t(`settings.groups.${group.key}`)));

    await picker.setValue("sounds");
    expect(w.get('[data-testid="settings-pane"]').text()).toContain("Notification sounds");
  });

  // Without roving tabindex a 24-entry sidebar is 24 Tab stops between the dialog and the setting
  // it was opened for — more keystrokes than the flat scroll this replaced.
  it("keeps the sidebar to one Tab stop, and moves within it on arrows", async () => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    const tabs = () => w.findAll('[role="tab"]');
    const selectedIndex = () => tabs().findIndex((t) => t.attributes("aria-selected") === "true");
    const start = selectedIndex();
    expect(tabs().filter((t) => t.attributes("tabindex") === "0")).toHaveLength(1);
    expect(tabs()[start].attributes("tabindex")).toBe("0");

    await tabs()[start].trigger("keydown", { key: "ArrowDown" });
    expect(selectedIndex()).toBe(start + 1);
    expect(tabs()[start + 1].attributes("tabindex")).toBe("0");
    expect(tabs()[start].attributes("tabindex")).toBe("-1");

    // Wraps at the ends rather than dead-ending on the first entry.
    await tabs()[start + 1].trigger("keydown", { key: "ArrowUp" });
    for (let i = start; i > 0; i--) await tabs()[i].trigger("keydown", { key: "ArrowUp" });
    expect(selectedIndex()).toBe(0);
    await tabs()[0].trigger("keydown", { key: "ArrowUp" });
    expect(selectedIndex()).toBe(tabs().length - 1);
  });

  // A pane is created on first visit and hidden after that, not destroyed. `v-if` alone threw away
  // whatever a section was holding but had not saved — and the font field keeps a typed stack in a
  // local draft precisely so a failed POST doesn't lose it (Codex review on #1565). Arrowing past
  // the tab is enough to hit this.
  it("keeps a typed but unapplied value when the user visits another tab and comes back", async () => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    await openTab(w, "font");
    const field = () => w.get('[data-testid="settings-pane-font"]').get("input");
    await field().setValue("'Cica'");

    await openTab(w, "sounds");
    expect((w.get('[data-testid="settings-pane-font"]').element as HTMLElement).style.display).toBe("none");

    await openTab(w, "font");
    expect((field().element as HTMLInputElement).value).toBe("'Cica'");
  });

  // The other half of the same contract: a tab never opened has not mounted, so opening Settings
  // for one setting does not fire every other section's GET.
  it("does not mount a pane until its tab is opened", async () => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    expect(w.find('[data-testid="settings-pane-cost"]').exists()).toBe(false);
    await openTab(w, "cost");
    expect(w.find('[data-testid="settings-pane-cost"]').exists()).toBe(true);
  });

  it("gives each tab exactly one entry, and each one its own words in every locale", () => {
    expect(new Set(SETTINGS_TABS).size).toBe(SETTINGS_TABS.length);
    UI_LOCALES.forEach(({ code }) => {
      const labels = SETTINGS_TABS.map((tab) => i18n.global.t(`settings.tabs.${tab}`, {}, { locale: code }));
      expect(new Set(labels).size, `two tabs read alike in ${code}`).toBe(SETTINGS_TABS.length);
    });
  });
});

describe("SettingsModal theme picker", () => {
  // The theme state is a module singleton read at import time, so the selection has to be made
  // through its own API — writing localStorage in the test would be read by nothing.
  const themeRadios = (w: Wrapper) => w.findAll('[role="radio"]').filter((r) => r.attributes("data-tip") !== undefined);
  const tabStops = (w: Wrapper) => themeRadios(w).filter((r) => r.attributes("tabindex") === "0");

  it("makes the selected theme the tab stop", () => {
    useTheme().setTheme("nord");
    const w = mountModal();
    expect(tabStops(w)).toHaveLength(1);
    expect(tabStops(w)[0].text()).toContain("Nord");
  });

  // Codex review on #996: with a selection naming a theme that isn't in the list — the
  // missing-theme case this build introduced — nothing matched, so every option was
  // tabindex="-1" and a keyboard user could not reach the picker the notice tells them to use.
  it("keeps one tab stop when the selection names a theme that is gone", () => {
    useTheme().setTheme("vanished-theme");
    const w = mountModal();
    expect(w.find('[data-testid="theme-missing"]').exists()).toBe(true);
    expect(tabStops(w)).toHaveLength(1);
    useTheme().setTheme("midnight");
  });
});

describe("SettingsModal", () => {
  it("no longer renders the directory-presets editor (presets are auto-managed)", async () => {
    const w = await mountTab("dirSettings");
    expect(w.find(".label-field").exists()).toBe(false);
    expect(w.find(".path-field").exists()).toBe(false);
    expect(w.findAll(".row")).toHaveLength(0);
    expect(w.text()).not.toContain("Directory presets");
  });

  it("emits close on the Close button", async () => {
    const w = mountModal();
    await clickBtn(w, (t) => t === "Close");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("emits close on Escape", async () => {
    const w = mountModal();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("shows the configured custom sound and emits update-sound on edit / clear", async () => {
    const w = await mountTab("sounds", { soundFile: "/snd/alert.wav" });
    const field = w.find('[aria-label="Custom notification sound file"]');
    expect((field.element as HTMLInputElement).value).toBe("/snd/alert.wav");

    await field.setValue("  /snd/new.mp3  ");
    await field.trigger("change");
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBe("/snd/new.mp3"); // trimmed

    await clickBtn(w, (t) => t.includes("chime"));
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBeNull(); // back to the chime
  });

  it("reflects pushEnabled and emits update-push-enabled on toggle", async () => {
    const w = await mountTab("push", { pushEnabled: true });
    const box = w.find<HTMLInputElement>('[aria-label="Send a Web Push to my devices"]');
    expect(box.element.checked).toBe(true);
    await box.setValue(false);
    expect(w.emitted("update-push-enabled")?.at(-1)?.[0]).toBe(false);

    // Defaults to unchecked when the prop is unset, and emits true when toggled on.
    const w2 = await mountTab("push", {});
    const box2 = w2.find<HTMLInputElement>('[aria-label="Send a Web Push to my devices"]');
    expect(box2.element.checked).toBe(false);
    await box2.setValue(true);
    expect(w2.emitted("update-push-enabled")?.at(-1)?.[0]).toBe(true);
  });

  // The setting exists so a user drowning in "waiting" pushes can keep the finished ones (#850),
  // so the emitted list — not just the click — is what matters.
  it("reflects pushKinds and emits the remaining kinds when one is unticked", async () => {
    const w = await mountTab("push", { pushEnabled: true, pushKinds: ["finished", "waiting"] });
    const waiting = w.find<HTMLInputElement>('[aria-label="Push when a session is waiting"]');
    expect(waiting.element.checked).toBe(true);
    await waiting.setValue(false);
    expect(w.emitted("update-push-kinds")?.at(-1)?.[0]).toEqual(["finished"]);
  });

  it("emits in the canonical order however the boxes were clicked", async () => {
    const w = await mountTab("push", { pushEnabled: true, pushKinds: [] });
    await w.find<HTMLInputElement>('[aria-label="Push when a session is waiting"]').setValue(true);
    expect(w.emitted("update-push-kinds")?.at(-1)?.[0]).toEqual(["waiting"]);
    await w.find<HTMLInputElement>('[aria-label="Push when a session is finished"]').setValue(true);
    expect(w.emitted("update-push-kinds")?.at(-1)?.[0]).toEqual(["finished", "waiting"]);
  });

  // The kinds decide nothing while the master switch is off, so offering them as live controls
  // would suggest otherwise.
  it("disables the kind checkboxes when push is off", async () => {
    const w = await mountTab("push", { pushEnabled: false, pushKinds: ["finished"] });
    expect(w.find<HTMLInputElement>('[aria-label="Push when a session is finished"]').element.disabled).toBe(true);
  });

  it("Browse fills the sound path from the OS file picker and applies it", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ paths: ["/picked/sound.ogg"] }) })) as unknown as typeof fetch;
    const w = await mountTab("sounds", { soundFile: null });
    await clickBtn(w, (t) => t.includes("Browse"));
    await flushPromises();
    expect((w.find('[aria-label="Custom notification sound file"]').element as HTMLInputElement).value).toBe("/picked/sound.ogg");
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBe("/picked/sound.ogg");
  });

  it("theme picker honors the radiogroup keyboard contract (arrows + roving tabindex)", async () => {
    const w = mountModal();
    const cards = () => w.findAll('[role="radio"]');
    const n = cards().length;
    expect(n).toBeGreaterThanOrEqual(2);
    const checked = () => cards().findIndex((c) => c.attributes("aria-checked") === "true");

    const start = checked();
    // roving tabindex: only the checked radio is tabbable
    expect(cards()[start].attributes("tabindex")).toBe("0");
    expect(cards()[(start + 1) % n].attributes("tabindex")).toBe("-1");

    await cards()[start].trigger("keydown", { key: "ArrowRight" });
    expect(checked()).toBe((start + 1) % n); // advances, wrapping at the end

    await cards()[checked()].trigger("keydown", { key: "ArrowLeft" });
    expect(checked()).toBe(start); // back to where we started
  });

  // The section offers a setting for a mic that only exists on a machine that can transcribe
  // (macOS + whisper-server + ffmpeg), so its whole contract is "the TAB appears iff the server
  // says capable" — including when the server can't be reached at all. The probe moved up to the
  // modal with the sidebar: a section that hid itself would leave an empty pane behind a button.
  describe("Voice input tab", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const voiceSelect = (w: Wrapper) => w.find('[aria-label="Language for voice input"]');

    it("shows the language picker when the server reports capable", async () => {
      stubServer(true);
      const w = mountModal();
      await flushPromises();
      await openTab(w, "voice");
      expect(voiceSelect(w).exists()).toBe(true);
      expect(w.text()).toContain("Voice input");
    });

    it("offers every language the picker exports, plus locale and auto", async () => {
      stubServer(true);
      const w = mountModal();
      await flushPromises();
      await openTab(w, "voice");
      const values = voiceSelect(w)
        .findAll("option")
        .map((o) => o.attributes("value"));
      expect(values).toEqual(["locale", "auto", ...VOICE_LANGUAGES.map((l) => l.code)]);
    });

    it("hides the tab when the machine cannot transcribe", async () => {
      stubServer(false);
      const w = mountModal();
      await flushPromises();
      expect(renderedTabs(w)).not.toContain("voice");
      expect(w.text()).not.toContain("Voice input");
    });

    // A probe that never answers must read as "no voice input", not as an empty tab or a thrown
    // error inside onMounted.
    it("hides the tab when the probe fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down");
        }),
      );

      const w = mountModal();
      await flushPromises();
      expect(renderedTabs(w)).not.toContain("voice");
    });

    it("hides the tab when the route is absent", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => (url === "/api/transcribe/model" ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({}) })),
      );

      const w = mountModal();
      await flushPromises();
      expect(renderedTabs(w)).not.toContain("voice");
    });
  });

  describe("Google account link (broker support)", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const mountGoogleTab = async (status: Record<string, unknown>) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, json: async () => status })),
      );
      const w = await mountTab("google");
      await flushPromises();
      return w;
    };

    it("disables sign-in when client secret is missing and broker is unavailable", async () => {
      const w = await mountGoogleTab({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: false, lastError: null });
      const signInBtn = w.findAll("button").find((b) => b.text().includes("Sign in"));
      expect(signInBtn).toBeTruthy();
      expect(signInBtn?.attributes("disabled")).toBe("");
    });

    it("enables sign-in when client secret is missing but broker is available", async () => {
      const w = await mountGoogleTab({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: true, lastError: null });
      const signInBtn = w.findAll("button").find((b) => b.text().includes("Sign in"));
      expect(signInBtn).toBeTruthy();
      expect(signInBtn?.attributes("disabled")).toBeUndefined();
    });

    it("hides the client secret warning when broker is available", async () => {
      const w = await mountGoogleTab({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: true, lastError: null });
      expect(w.find('[data-testid="google-warn"]').exists()).toBe(false);
    });

    it("shows the client secret warning when broker is unavailable and secret is missing", async () => {
      const w = await mountGoogleTab({ linked: false, pending: false, clientSecret: "missing", brokerAvailable: false, lastError: null });
      const warning = w.find('[data-testid="google-warn"]');
      expect(warning.exists()).toBe(true);
      expect(warning.text()).toContain("client_secret");
    });
  });
});

describe("SettingsModal per-kind sounds (#873)", () => {
  const selectFor = (w: Wrapper, label: string) => w.find(`select[aria-label="Sound for ${label}"]`);

  // SELECT_CONTROL is `w-full`. A width utility written NEXT to it on the same element has the
  // same specificity, so which one applies depends on the order Tailwind emits them — and the
  // select ended up full-width, pushing itself and the play button out of the row. The width
  // belongs to a wrapper, where `w-full` then means "as wide as the slot I was given".
  it("sizes the sound select from its wrapper, not from a utility racing w-full", async () => {
    const w = await mountTab("sounds", { soundKinds: ["finished"] });
    const select = w.find('select[aria-label="Sound for Turn finished"]');
    expect(select.classes().some((c) => /^w-\d/.test(c))).toBe(false);
    expect(select.element.parentElement?.className).toContain("w-36");
  });

  it("offers a row per notification kind, with the new kinds unticked by default", async () => {
    const w = await mountTab("sounds", { soundKinds: ["finished", "waiting"] });
    expect(w.text()).toContain("Turn finished");
    expect(w.text()).toContain("Command failed");
    expect(w.text()).toContain("PR CI failed");
    const box = (kind: string) => w.find(`input[aria-label="Beep when a session is ${kind}"]`).element as HTMLInputElement;
    expect(box("finished").checked).toBe(true);
    expect(box("command-failed").checked).toBe(false);
  });

  it("emits the whole map, dropping the entry when a kind goes back to the fallback", async () => {
    const w = await mountTab("sounds", { soundKinds: ["finished", "waiting"], sounds: { finished: "preset:coin", waiting: "preset:gong" } });
    await selectFor(w, "Turn finished").setValue("");
    const emitted = w.emitted("update-sounds");
    expect(emitted?.at(-1)?.[0]).toEqual({ waiting: "preset:gong" });
  });

  // The whole map is persisted on every change, so a second pick made BEFORE the first save
  // answers must build on the first — otherwise it silently reverts it. Props deliberately
  // stay put here: that is what an in-flight POST looks like from the component's side.
  it("keeps an earlier pick when a second is made before the save lands", async () => {
    const w = await mountTab("sounds", { soundKinds: ["finished", "waiting"], sounds: {} });
    await selectFor(w, "Turn finished").setValue("preset:coin");
    await selectFor(w, "Waiting for you").setValue("preset:meow");
    const emitted = w.emitted("update-sounds");
    expect(emitted?.at(-1)?.[0]).toEqual({ finished: "preset:coin", waiting: "preset:meow" });
  });

  it("emits the kind list in NOTIFY_KINDS order however it was clicked", async () => {
    const w = await mountTab("sounds", { soundKinds: [] });
    await w.find('input[aria-label="Beep when a session is pr-ci-failed"]').setValue(true);
    await w.find('input[aria-label="Beep when a session is finished"]').setValue(true);
    expect(w.emitted("update-sound-kinds")?.at(-1)?.[0]).toEqual(["finished", "pr-ci-failed"]);
  });

  // Wiring only — what the preview shows for each directory is DirConfigPreview.spec.ts.
  it("hands the directory list to the config preview, and asks for nothing until one is expanded", async () => {
    const w = await mountTab("dirSettings", { dirPaths: ["/proj/a", "/proj/b"] });
    await flushPromises();
    expect(w.findAll('[data-testid="dir-preview-row"]')).toHaveLength(2);
  });

  // #2624: the Files view sits under this modal, so opening a config there closes Settings first.
  it("closes Settings and opens the file a directory row asks for", async () => {
    filesOpened.length = 0;
    const w = await mountTab("dirSettings", { dirPaths: ["/proj/a"] });
    await flushPromises();
    w.findComponent({ name: "DirConfigPreview" }).vm.$emit("open-file", "/proj/a", ".mulmoterminal.json");
    expect(w.emitted("close")).toHaveLength(1);
    expect(filesOpened).toEqual([["/proj/a", ".mulmoterminal.json"]]);
  });
});

// Each Settings section that a skill can write hands off to that skill (#1111). The list is
// ENUMERATED from what actually rendered rather than typed out here: a hand-written list is
// agreed with by a check written from the same list, so a button pointing at a skill that
// doesn't ship — or one silently dropped in an edit — passes both (the lesson from #1104's
// guide renumbering).
describe("SettingsModal skill buttons", () => {
  afterEach(() => vi.unstubAllGlobals());

  // One pane at a time now, so the enumeration has to walk the sidebar rather than read one render.
  const skillsAcrossTabs = async (): Promise<{ tab: string; skill: string; label: string }[]> => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    const found: { tab: string; skill: string; label: string }[] = [];
    for (const tab of SETTINGS_TABS) {
      await openTab(w, tab);
      await flushPromises();
      w.findAllComponents(SkillLaunchButton).forEach((b) => found.push({ tab, skill: b.props("skill"), label: b.props("label") }));
    }
    return found;
  };

  it("only offers skills that MulmoTerminal ships", async () => {
    const found = await skillsAcrossTabs();
    expect(found.length).toBeGreaterThan(0);
    found.forEach(({ skill }) => expect(BUNDLED_SKILL_NAMES).toContain(skill));
  });

  // The mapping a user relies on: press the button in the section you are looking at, get the
  // skill that owns those keys. `-config` is the router/audit and belongs to the section that
  // SHOWS a broken setting; the rest own one area each.
  it.each([
    ["theme", "Create a theme…", "mulmoterminal-theme"],
    ["dirAppearance", "Configure appearance…", "mulmoterminal-dirs"],
    ["dirSettings", "Explain my settings…", "mulmoterminal-config"],
    ["sounds", "Configure notifications…", "mulmoterminal-notify"],
    ["shortcuts", "Set up shortcuts…", "mulmoterminal-keys"],
    ["models", "Add a backend…", "mulmoterminal-model"],
    ["headerChrome", "Set up header buttons…", "mulmoterminal-header"],
  ])("the %s tab's %s launches %s", async (tab, label, skill) => {
    const w = await mountTab(tab as SettingsTabId);
    await flushPromises();
    const button = w.findAllComponents(SkillLaunchButton).find((b) => b.props("label") === label);
    if (!button) throw new Error(`no Settings button labelled "${label}" on the "${tab}" tab`);
    await button.find("button").trigger("click");
    // Nothing starts on the press itself now (#1564) — the session begins when Start is answered.
    expect(w.emitted("launch-skill")).toBeUndefined();
    await w.get('[data-testid="skill-launch-start"]').trigger("click");
    expect(w.emitted("launch-skill")?.at(-1)?.[0]).toBe(skill);
  });
});

// The sections that gave a config.json-only setting a control (#1401). Asserted through the MODAL
// rather than each section alone: a section can mount perfectly and still be absent from the app,
// which is the state every one of these keys was already in.
describe("SettingsModal reaches the config-only settings", () => {
  it.each<[SettingsTabId, string]>([
    ["font", "Terminal font family stack"],
    ["waitingRows", "Increase summary line count"],
    ["github", "Comment on the issue a cell is working on"],
    ["github", "End a created PR with the clone name"],
    ["github", "Add a self-hosted GitLab host"],
    ["sessions", "End replies with a closing summary"],
    ["sessions", "Keep a digest of decisions"],
    ["sessions", "Keep a periodic dev-work log"],
    ["sessions", "Increase dev-work log interval"],
    ["terminalKeys", "Copy a selection as soon as it settles"],
    ["terminalKeys", "Which bytes submit in a Claude session"],
  ])("the %s tab offers %s", async (tab, ariaLabel) => {
    const w = await mountTab(tab);
    expect(w.find(`[aria-label="${ariaLabel}"]`).exists()).toBe(true);
  });
});

// Pressing a skill button used to close Settings, spawn an agent in a new cell and send its first
// turn, with nothing on screen saying so and nothing to go back to (#1564).
describe("SettingsModal skill launch confirmation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Restored here rather than at the end of the test that changes it: an assertion that throws
    // would otherwise leave the next test running as codex and failing for the wrong reason
    // (CodeRabbit on #1568).
    launchAgent.value = "claude";
  });

  // Attached to the document so focus is real: an element outside it can be focused in jsdom but
  // `document.activeElement` stays on <body>, which is exactly the state being asserted against.
  const pressTheme = async () => {
    stubServer(true);
    const w = mount(SettingsModal, { attachTo: document.body });
    await flushPromises();
    await w.findAllComponents(SkillLaunchButton)[0].find("button").trigger("click");
    await flushPromises();
    return w;
  };

  it("asks before starting anything, and says how to stop", async () => {
    const w = await pressTheme();
    const dialog = w.get('[data-testid="skill-launch-confirm"]');
    expect(dialog.text()).toContain(en.settings.skillConfirm.title);
    expect(dialog.text()).toContain(en.settings.skillConfirm.howToStop.slice(0, 20));
    expect(w.emitted("launch-skill")).toBeUndefined();
  });

  it("names the agent the picker is set to, not a hard-coded claude", async () => {
    launchAgent.value = "codex";
    const w = await pressTheme();
    expect(w.get('[data-testid="skill-launch-confirm"]').text()).toContain("codex");
  });

  // Naming it was half the answer (#1564); the other half is being able to change it here rather
  // than closing Settings to go and find the Collections overlay's dropdown (#1938).
  it("lets the agent be changed from the dialog, and says so in the same breath", async () => {
    launchAgent.value = "muse";
    const w = await pressTheme();
    const dialog = w.get('[data-testid="skill-launch-confirm"]');
    const select = dialog.get('[data-testid="launch-agent-picker"] select');
    expect((select.element as HTMLSelectElement).value).toBe("muse");
    await select.setValue("claude");
    await flushPromises();
    expect(launchAgent.value).toBe("claude");
    // The sentence above the picker reads the same value, so it moves with it. Compared against
    // the interpolated sentence rather than the bare word: the option list spells the agents too
    // ("Muse"), so a substring match would pass on the control instead of on the explanation.
    expect(dialog.text()).toContain(i18n.global.t("settings.skillConfirm.what", { agent: "claude" }));
  });

  it("emits nothing on Cancel, and leaves Settings open", async () => {
    const w = await pressTheme();
    await w.get('[data-testid="skill-launch-cancel"]').trigger("click");
    expect(w.emitted("launch-skill")).toBeUndefined();
    expect(w.emitted("close")).toBeUndefined();
    expect(w.find('[data-testid="skill-launch-confirm"]').exists()).toBe(false);
    expect(w.find('[data-testid="settings-pane"]').exists()).toBe(true);
    w.unmount();
  });

  // Focus moves INTO the dialog, so dismissing it without putting focus back drops a keyboard user
  // on <body> — out of the modal they were part way through (Codex and CodeRabbit on #1568).
  it.each([
    ["Cancel", async (w: Wrapper) => w.get('[data-testid="skill-launch-cancel"]').trigger("click")],
    ["Escape", async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))],
  ])("gives focus to the dialog, and back to the button it came from on %s", async (_how, dismiss) => {
    const w = await pressTheme();
    const trigger = w.findAllComponents(SkillLaunchButton)[0].find("button").element;
    expect(w.get('[data-testid="skill-launch-confirm"]').element.contains(document.activeElement)).toBe(true);

    await dismiss(w);
    await flushPromises();
    expect(document.activeElement).toBe(trigger);
    w.unmount();
  });

  // The reason the confirmation lives in the modal rather than in the button: one document-level
  // Escape listener, layered. Two would close the confirm AND the modal behind it on one press.
  it("answers Escape with the confirm first, and only then closes the modal", async () => {
    const w = await pressTheme();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(w.find('[data-testid="skill-launch-confirm"]').exists()).toBe(false);
    expect(w.emitted("close")).toBeUndefined();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  // Enumerated from what renders rather than from a list typed here: a button wired straight to the
  // old path would start a session with no dialog, and only this notices. The help desk is the one
  // deliberate exception (it edits nothing; see "Settings Help tab"), named here so a second one
  // cannot join it unnoticed.
  it("routes every skill button in the modal through it, except the help desk", async () => {
    stubServer(true);
    const w = mountModal();
    await flushPromises();
    // A Set: visited panes stay mounted (v-show), so the same button is met again on every later tab.
    const exempt = new Set<string>();
    for (const tab of SETTINGS_TABS) {
      await openTab(w, tab);
      await flushPromises();
      for (const button of w.findAllComponents(SkillLaunchButton)) {
        if (button.props("skill") === "mulmoterminal-help") {
          exempt.add(button.props("skill"));
          continue;
        }
        await button.find("button").trigger("click");
        expect(w.find('[data-testid="skill-launch-confirm"]').exists(), `${tab} did not confirm`).toBe(true);
        expect(w.emitted("launch-skill"), `${tab} started without asking`).toBeUndefined();
        await w.get('[data-testid="skill-launch-cancel"]').trigger("click");
      }
    }
    expect([...exempt]).toEqual(["mulmoterminal-help"]);
  });
});

// #2450. The command palette asks for a section by name: the modal opens on it, forgets the request,
// and a second request while open moves to that section.
describe("a section asked for by name", () => {
  const selected = (w: Wrapper) => w.find('[aria-selected="true"]').attributes("data-testid");

  it("opens on the requested section and clears the request", async () => {
    requestedSettingsTab.value = "shortcuts";
    const w = mountModal();
    await flushPromises();
    expect(selected(w)).toBe("settings-tab-shortcuts");
    expect(requestedSettingsTab.value).toBeNull();
    w.unmount();
  });

  it("moves to a section asked for while it is open, and opens on the default without a request", async () => {
    const w = mountModal();
    await flushPromises();
    expect(selected(w)).toBe(`settings-tab-${DEFAULT_SETTINGS_TAB}`);
    requestedSettingsTab.value = "sounds";
    await flushPromises();
    expect(selected(w)).toBe("settings-tab-sounds");
    w.unmount();
  });

  // Voice is in the sidebar only once this modal's probe says the machine can transcribe.
  it("shows Voice when asked only once the probe says it can, and stays put when it cannot", async () => {
    stubServer(true);
    requestedSettingsTab.value = "voice";
    const capable = mountModal();
    expect(selected(capable)).toBe(`settings-tab-${DEFAULT_SETTINGS_TAB}`);
    await flushPromises();
    expect(selected(capable)).toBe("settings-tab-voice");
    capable.unmount();

    stubServer(false);
    requestedSettingsTab.value = "voice";
    const incapable = mountModal();
    await flushPromises();
    expect(selected(incapable)).toBe(`settings-tab-${DEFAULT_SETTINGS_TAB}`);
    expect(requestedSettingsTab.value).toBeNull();
    incapable.unmount();
  });

  // Closing before the probe answers must not leave the request for the next plain open.
  it("forgets a Voice request still waiting when Settings closes", async () => {
    stubServer(true);
    openSettingsAt("voice");
    const w = mountModal();
    closeSettings();
    w.unmount();
    expect(requestedSettingsTab.value).toBeNull();
    expect(settingsOpen.value).toBe(false);
  });
});

// The one skill button that does NOT ask first (#2984): the confirm exists to warn before an agent
// edits the config file, and the help desk only reads. The modal closes and the chat starts at once.
describe("Settings Help tab", () => {
  it("starts the help desk on the press, without the confirmation, and closes", async () => {
    helpOpened.count = 0;
    const w = await mountTab("help");
    await flushPromises();
    const button = w.findAllComponents(SkillLaunchButton).find((b) => b.props("skill") === "mulmoterminal-help");
    if (!button) throw new Error("no help button on the Help tab");
    expect(button.text()).toContain(en.settings.help.hint);
    await button.find("button").trigger("click");
    expect(w.find('[data-testid="skill-launch-confirm"]').exists()).toBe(false);
    expect(w.emitted("launch-skill")).toBeUndefined();
    expect(helpOpened.count).toBe(1);
    expect(w.emitted("close")).toHaveLength(1);
  });
});
