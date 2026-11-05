import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mount, shallowMount } from "@vue/test-utils";
import { nextTick } from "vue";
import { i18n } from "../../../src/i18n";

vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({ subscribe: () => () => {}, onReconnect: () => () => {} }),
}));

// xterm cannot open() in jsdom, and none of it is the subject: this is about whether the banner
// is drawn, which is decided from the connection view and the switch.
vi.mock("../../../src/composables/useTerminalConnections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/composables/useTerminalConnections")>()),
  attach: () => {},
  detach: () => {},
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const { connView } = await import("../../../src/composables/useTerminalConnections");
const { useCopyModeBanner } = await import("../../../src/composables/useCopyModeBanner");
const Terminal = (await import("../../../src/components/Terminal.vue")).default;
const TerminalScrollSection = (await import("../../../src/components/settings/TerminalScrollSection.vue")).default;

const SLOT = "copy-mode-banner-switch";
const bannerCount = (inCopyMode: boolean) => {
  connView.set(SLOT, { status: "connected", serverCwd: "/w", inCopyMode, heatLevel: 0, heatFinales: 0, sessionEnded: false });
  const wrapper = shallowMount(Terminal, {
    props: { sessionId: "s1", connectKey: 0, cwd: "/w", persistKey: SLOT },
    global: { stubs: { teleport: true } },
  });
  return wrapper.findAllComponents({ name: "CopyModeBanner" }).length;
};

describe("the copy-mode banner switch", () => {
  beforeEach(() => useCopyModeBanner().setCopyModeBanner(true));

  it("draws the banner in copy-mode by default, and not outside it", () => {
    expect(bannerCount(true)).toBe(1);
    expect(bannerCount(false)).toBe(0);
  });

  it("stops drawing it, in copy-mode, once the switch is off", () => {
    useCopyModeBanner().setCopyModeBanner(false);
    expect(bannerCount(true)).toBe(0);
  });

  it("is driven by the Settings checkbox, which starts ticked", async () => {
    const settings = mount(TerminalScrollSection);
    const box = settings.get('[data-testid="copy-mode-banner-toggle"]');
    expect(box.element).toBeInstanceOf(HTMLInputElement);
    expect(box.element instanceof HTMLInputElement && box.element.checked).toBe(true);
    await box.setValue(false);
    await nextTick();
    expect(bannerCount(true)).toBe(0);
    await box.setValue(true);
    await nextTick();
    expect(bannerCount(true)).toBe(1);
  });

  // The aria-label names the checkbox; without a description its hint (what the banner is and that q
  // still returns) is never announced.
  it("describes the checkbox with its hint, which the accessible name does not carry", () => {
    const settings = mount(TerminalScrollSection, { attachTo: document.body });
    const box = settings.get('[data-testid="copy-mode-banner-toggle"]');
    const described = document.getElementById(box.attributes("aria-describedby") ?? "");
    expect(described?.textContent).toBe(i18n.global.t("terminal.copyMode.settingHint"));
    settings.unmount();
  });
});
