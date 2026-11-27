// The picked skill's SKILL.md in the Skills viewer, which is kept while closed: it is read again on the
// next opening, a failed re-read keeps it, and a read from before the close never wins over a newer one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import { skillsViewEn } from "../../../src/i18n/skillsView/en";

const open = ref(true);
vi.mock("../../../src/composables/useSkillsView", () => ({ useSkillsView: () => ({ isOpen: open, close: () => {} }) }));

type DocAnswer = { markdown: string; version: string } | null;
const docs: ((answer: DocAnswer) => void)[] = [];
const listedCatalog: { current: unknown } = { current: null };
const catalog = {
  sources: [{ scope: "user", dir: "/h/.claude/skills", plugin: "", skills: [{ slug: "publish", id: "publish", description: "", overridesUser: false }] }],
};
vi.mock("../../../src/composables/useSkillCatalog", () => ({
  loadSkillCatalog: () => Promise.resolve(listedCatalog.current),
  loadSkillDoc: () => new Promise<DocAnswer>((resolve) => docs.push(resolve)),
  loadSkillUsage: () => Promise.resolve(null),
}));
vi.mock("../../../src/composables/skillEvalApi", () => ({ loadSkillEvalMarks: () => Promise.resolve(null), loadSkillEval: () => Promise.resolve(null) }));
const SkillsOverlay = (await import("../../../src/components/SkillsOverlay.vue")).default;
const SkillDocEditor = (await import("../../../src/components/SkillDocEditor.vue")).default;

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: skillsViewEn } });
const doc = (text: string): DocAnswer => ({ markdown: text, version: text });

beforeEach(() => {
  listedCatalog.current = catalog;
  docs.length = 0;
  open.value = true;
});

const reopen = async () => {
  open.value = false;
  await flushPromises();
  open.value = true;
  await flushPromises();
};

describe("the picked skill's SKILL.md", () => {
  it("is read again on the next opening, and kept through a failed re-read", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    docs.shift()?.(doc("first text"));
    await flushPromises();
    expect(wrapper.text()).toContain("first text");
    await reopen();
    expect(docs).toHaveLength(1);
    docs.shift()?.(doc("edited text"));
    await flushPromises();
    expect(wrapper.text()).toContain("edited text");
    await reopen();
    docs.shift()?.(null);
    await flushPromises();
    expect(wrapper.text()).toContain("edited text");
    expect(wrapper.find("[data-testid=skills-doc-error]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("does not let a read from before a close replace the newer one", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    const early = docs.shift();
    await reopen();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    docs.splice(0).forEach((answer) => answer(doc("fresh text")));
    await flushPromises();
    early?.(doc("stale text"));
    await flushPromises();
    expect(wrapper.text()).toContain("fresh text");
    expect(wrapper.text()).not.toContain("stale text");
    wrapper.unmount();
  });
});

describe("reads of the SKILL.md around a close", () => {
  it("says it could not be read when the re-read that overtook the first one fails", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    await reopen(); // the first read is still out; this one overtakes it
    docs.at(-1)?.(null);
    await flushPromises();
    expect(wrapper.find("[data-testid=skills-doc-error]").exists()).toBe(true);
    wrapper.unmount();
  });

  it("does not let a read from before an edit replace the text it saved", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    docs.shift()?.(doc("as opened"));
    await flushPromises();
    await reopen();
    const outstanding = docs.shift();
    await wrapper.get("[data-testid=skills-edit]").trigger("click");
    wrapper.findComponent(SkillDocEditor).vm.$emit("saved", "as saved", "v2");
    await flushPromises();
    outstanding?.(doc("from before the edit"));
    await flushPromises();
    expect(wrapper.text()).toContain("as saved");
    expect(wrapper.text()).not.toContain("from before the edit");
    wrapper.unmount();
  });
});

describe("an adoption answering after the screen was closed", () => {
  it("reads no document while hidden, and leaves the one shown", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    docs.shift()?.(doc("as shown"));
    await flushPromises();
    open.value = false;
    await flushPromises();
    wrapper.findComponent({ name: "SkillEvalPanel" }).vm.$emit("adopted");
    await flushPromises();
    expect(docs).toHaveLength(0);
    expect(wrapper.text()).toContain("as shown");
    wrapper.unmount();
  });
});

describe("a skill removed while the screen was closed", () => {
  it("takes its SKILL.md and evaluation off the screen on the next opening", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    docs.shift()?.(doc("about to go"));
    await flushPromises();
    expect(wrapper.text()).toContain("about to go");
    listedCatalog.current = { sources: [{ ...catalog.sources[0], skills: [] }] };
    await reopen();
    docs.splice(0).forEach((answer) => answer(doc("about to go")));
    await flushPromises();
    expect(wrapper.text()).not.toContain("about to go");
    expect(wrapper.findComponent({ name: "SkillEvalPanel" }).exists()).toBe(false);
    wrapper.unmount();
  });
});

// An edit is the person's text: the catalog moving under it waits until the edit ends.
describe("a skill removed while it is being edited", () => {
  const twoSkills = {
    sources: [{ ...catalog.sources[0], skills: [...catalog.sources[0].skills, { slug: "deploy", id: "deploy", description: "", overridesUser: false }] }],
  };
  const editAfterRemoval = async (after: unknown) => {
    listedCatalog.current = twoSkills;
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    docs.shift()?.(doc("being edited"));
    await flushPromises();
    await wrapper.get("[data-testid=skills-edit]").trigger("click");
    await wrapper.get("[data-testid=skill-editor-field]").setValue("a draft not saved yet");
    listedCatalog.current = after;
    await reopen();
    return wrapper;
  };

  it("is taken off the screen once the edit is cancelled, or saved", async () => {
    const withoutIt = { sources: [{ ...twoSkills.sources[0], skills: [twoSkills.sources[0].skills[1]] }] };
    const cancelled = await editAfterRemoval(withoutIt);
    expect(cancelled.find("[data-testid=skill-editor]").exists()).toBe(true);
    await cancelled.get("[data-testid=skill-editor-cancel]").trigger("click");
    await flushPromises();
    expect(cancelled.text()).not.toContain("being edited");
    expect(cancelled.findComponent({ name: "SkillEvalPanel" }).exists()).toBe(false);
    cancelled.unmount();
    const saved = await editAfterRemoval(withoutIt);
    saved.findComponent(SkillDocEditor).vm.$emit("saved", "as saved", "v2");
    await flushPromises();
    expect(saved.text()).not.toContain("as saved");
    expect(saved.findComponent({ name: "SkillEvalPanel" }).exists()).toBe(false);
    saved.unmount();
  });

  it("keeps the editor and its draft when the catalog empties, or the search matches nothing", async () => {
    const emptied = await editAfterRemoval({ sources: [] });
    expect(emptied.get<HTMLTextAreaElement>("[data-testid=skill-editor-field]").element.value).toBe("a draft not saved yet");
    emptied.unmount();
    const searched = await editAfterRemoval(twoSkills);
    await searched.get("[data-testid=skills-search]").setValue("nothing is called this");
    await flushPromises();
    expect(searched.get<HTMLTextAreaElement>("[data-testid=skill-editor-field]").element.value).toBe("a draft not saved yet");
    searched.unmount();
  });
});
