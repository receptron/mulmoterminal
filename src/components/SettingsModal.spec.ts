import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SettingsModal from "./SettingsModal.vue";

const mountModal = (presets = [{ label: "proj", path: "/work/proj" }]) => mount(SettingsModal, { props: { presets } });

function clickBtn(w: ReturnType<typeof mount>, match: (text: string) => boolean) {
  const btn = w.findAll(".btn").find((b) => match(b.text()));
  if (!btn) throw new Error("button not found");
  return btn.trigger("click");
}

describe("SettingsModal", () => {
  it("shows a row per preset", () => {
    const w = mountModal([
      { label: "a", path: "/a" },
      { label: "b", path: "/b" },
    ]);
    expect(w.findAll(".row")).toHaveLength(2);
  });

  it("adds and removes rows", async () => {
    const w = mountModal([{ label: "a", path: "/a" }]);
    await clickBtn(w, (t) => t.includes("Add"));
    expect(w.findAll(".row")).toHaveLength(2);
    await w.findAll(".row")[0].find(".icon-btn").trigger("click");
    expect(w.findAll(".row")).toHaveLength(1);
  });

  it("save emits trimmed presets, dropping rows missing a label or path", async () => {
    const w = mountModal([
      { label: " keep ", path: " /keep " },
      { label: "", path: "/nolabel" },
      { label: "nopath", path: "" },
    ]);
    await clickBtn(w, (t) => t === "Save");
    expect(w.emitted("save")?.[0]?.[0]).toEqual([{ label: "keep", path: "/keep" }]);
  });

  it("emits close on Cancel", async () => {
    const w = mountModal();
    await clickBtn(w, (t) => t === "Cancel");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("emits close on Escape", async () => {
    const w = mountModal();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("shows an error and disables Save while saving", () => {
    const w = mount(SettingsModal, { props: { presets: [], saving: true, error: "boom" } });
    expect(w.find(".error").text()).toBe("boom");
    const save = w.findAll(".btn").find((b) => b.text().includes("Saving"));
    expect(save?.attributes("disabled")).toBeDefined();
  });

  it("does not mutate the prop array until save", async () => {
    const presets = [{ label: "a", path: "/a" }];
    const w = mountModal(presets);
    await clickBtn(w, (t) => t.includes("Add"));
    expect(presets).toHaveLength(1); // edits are on a local copy
  });
});
