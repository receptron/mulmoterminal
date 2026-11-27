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
const catalog = {
  sources: [{ scope: "user", dir: "/h/.claude/skills", plugin: "", skills: [{ slug: "publish", id: "publish", description: "", overridesUser: false }] }],
};
vi.mock("../../../src/composables/useSkillCatalog", () => ({
  loadSkillCatalog: () => Promise.resolve(catalog),
  loadSkillDoc: () => new Promise<DocAnswer>((resolve) => docs.push(resolve)),
  loadSkillUsage: () => Promise.resolve(null),
}));
vi.mock("../../../src/composables/skillEvalApi", () => ({ loadSkillEvalMarks: () => Promise.resolve(null), loadSkillEval: () => Promise.resolve(null) }));
const SkillsOverlay = (await import("../../../src/components/SkillsOverlay.vue")).default;

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: skillsViewEn } });
const doc = (text: string): DocAnswer => ({ markdown: text, version: text });

beforeEach(() => {
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
