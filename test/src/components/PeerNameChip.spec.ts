// The chip that copies the name other Claude Code sessions message this cell by (#3237).
import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import PeerNameChip from "../../../src/components/PeerNameChip.vue";

const clipboard = (writeText: (text: string) => Promise<void>) => vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PeerNameChip", () => {
  it("draws nothing for a cell no claude answers to", () => {
    expect(
      mount(PeerNameChip, { props: { name: null } })
        .find('[data-testid="cell-peer-chip"]')
        .exists(),
    ).toBe(false);
  });

  it("is an icon whose tooltip and label carry the name", () => {
    const chip = mount(PeerNameChip, { props: { name: "proj-7f" } }).get('[data-testid="cell-peer-chip"]');
    expect(chip.text()).toBe("alternate_email");
    expect(chip.attributes("data-tip")).toContain("proj-7f");
    expect(chip.attributes("aria-label")).toContain("proj-7f");
  });

  it("copies the name on press, says so for a moment, and does not reach the row behind it", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    const behind = vi.fn();
    const wrapper = mount({ components: { PeerNameChip }, methods: { behind }, template: '<div @click="behind"><PeerNameChip name="proj-7f" /></div>' });
    const chip = wrapper.get('[data-testid="cell-peer-chip"]');
    await chip.trigger("click");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("proj-7f"));
    await wrapper.vm.$nextTick();
    expect(chip.text()).toBe("check");
    expect(chip.attributes("data-tip")).toContain("proj-7f");
    expect(behind).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    await wrapper.vm.$nextTick();
    expect(chip.text()).toBe("alternate_email");
  });

  it("stays an icon when the clipboard refuses, with the name still on the tooltip", async () => {
    clipboard(async () => {
      throw new Error("not allowed");
    });
    const chip = mount(PeerNameChip, { props: { name: "proj-7f" } }).get('[data-testid="cell-peer-chip"]');
    await chip.trigger("click");
    await Promise.resolve();
    expect(chip.text()).toBe("alternate_email");
    expect(chip.attributes("data-tip")).toContain("proj-7f");
  });
});
