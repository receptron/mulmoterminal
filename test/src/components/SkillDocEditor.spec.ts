// Editing a SKILL.md in the Skills viewer (#3332): saved over the version opened, a change since said.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const saves: unknown[][] = [];
let answer: { kind: string; version?: string } = { kind: "saved", version: "v2" };
vi.mock("../../../src/composables/useSkillCatalog", () => ({
  saveSkillDoc: (...args: unknown[]) => (saves.push(args), Promise.resolve(answer)),
}));
const SkillDocEditor = (await import("../../../src/components/SkillDocEditor.vue")).default;

const source = { scope: "user" as const, plugin: "", dir: "/h/.claude/skills", skills: [] };
beforeEach(() => {
  saves.length = 0;
  answer = { kind: "saved", version: "v2" };
});

const mountEditor = () => mount(SkillDocEditor, { props: { source, slug: "review", text: "# review", version: "v1" }, attachTo: document.body });

describe("SkillDocEditor", () => {
  it("saves the whole text over the version it opened on ⌘Enter", async () => {
    const wrapper = mountEditor();
    await wrapper.find("[data-testid=skill-editor-field]").setValue("# review, edited");
    await wrapper.find("[data-testid=skill-editor-field]").trigger("keydown", { key: "Enter", metaKey: true });
    await flushPromises();
    expect(saves).toEqual([[source, "review", "# review, edited", "v1"]]);
    expect(wrapper.emitted("saved")).toEqual([["# review, edited", "v2"]]);
  });
  it("says the file changed since and offers to read it again, saving nothing", async () => {
    answer = { kind: "changed" };
    const wrapper = mountEditor();
    await wrapper.find("[data-testid=skill-editor-save]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=skill-editor-notice]").text()).toContain("changed on disk");
    expect(wrapper.emitted("saved")).toBeUndefined();
  });
  it("cancels on Esc without the viewer seeing it", async () => {
    const wrapper = mountEditor();
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const reached = vi.fn();
    window.addEventListener("keydown", reached);
    wrapper.find("[data-testid=skill-editor-field]").element.dispatchEvent(esc);
    window.removeEventListener("keydown", reached);
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(reached).not.toHaveBeenCalled();
  });
});
