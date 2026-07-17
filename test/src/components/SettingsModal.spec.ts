import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsModal from "../../../src/components/SettingsModal.vue";

const mountModal = (props: Record<string, unknown> = {}) => mount(SettingsModal, { props });

function clickBtn(w: ReturnType<typeof mount>, match: (text: string) => boolean) {
  const btn = w.findAll(".btn").find((b) => match(b.text()));
  if (!btn) throw new Error("button not found");
  return btn.trigger("click");
}

describe("SettingsModal", () => {
  it("no longer renders the directory-presets editor (presets are auto-managed)", () => {
    const w = mountModal();
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
    const w = mountModal({ soundFile: "/snd/alert.wav" });
    const field = w.find(".sound-field");
    expect((field.element as HTMLInputElement).value).toBe("/snd/alert.wav");

    await field.setValue("  /snd/new.mp3  ");
    await field.trigger("change");
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBe("/snd/new.mp3"); // trimmed

    await clickBtn(w, (t) => t.includes("chime"));
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBeNull(); // back to the chime
  });

  it("Browse fills the sound path from the OS file picker and applies it", async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ paths: ["/picked/sound.ogg"] }) })) as unknown as typeof fetch;
    const w = mountModal({ soundFile: null });
    await clickBtn(w, (t) => t.includes("Browse"));
    await Promise.resolve();
    expect((w.find(".sound-field").element as HTMLInputElement).value).toBe("/picked/sound.ogg");
    expect(w.emitted("update-sound")?.at(-1)?.[0]).toBe("/picked/sound.ogg");
  });

  it("theme picker honors the radiogroup keyboard contract (arrows + roving tabindex)", async () => {
    const w = mountModal();
    const cards = () => w.findAll(".theme-card");
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
});
