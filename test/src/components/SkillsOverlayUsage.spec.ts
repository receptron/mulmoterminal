// How often each skill ran, in the Skills viewer (#3437): the count on each row, "unused" for none,
// nothing at all when the index cannot say, and a late answer from an earlier opening never wins.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import type { SkillUsage } from "../../../common/skillUsage";
import { skillsViewEn } from "../../../src/i18n/skillsView/en";

const open = ref(true);
vi.mock("../../../src/composables/useSkillsView", () => ({ useSkillsView: () => ({ isOpen: open, close: () => {} }) }));

type UsageAnswer = ReadonlyMap<string, SkillUsage> | null;
const pending: ((answer: UsageAnswer) => void)[] = [];
const catalog = {
  sources: [
    {
      scope: "user",
      dir: "/h/.claude/skills",
      plugin: "",
      skills: [
        { slug: "publish", id: "publish", description: "", overridesUser: false },
        { slug: "tidy", id: "tidy", description: "", overridesUser: false },
      ],
    },
  ],
};
vi.mock("../../../src/composables/useSkillCatalog", () => ({
  loadSkillCatalog: () => Promise.resolve(catalog),
  loadSkillDoc: () => Promise.resolve(null),
  loadSkillUsage: () => new Promise<UsageAnswer>((resolve) => pending.push(resolve)),
}));
// The marks come from their own read (#3467); none here, so this spec never reaches a server.
vi.mock("../../../src/composables/skillEvalApi", () => ({ loadSkillEvalMarks: () => Promise.resolve(null), loadSkillEval: () => Promise.resolve(null) }));
const SkillsOverlay = (await import("../../../src/components/SkillsOverlay.vue")).default;

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: skillsViewEn } });
const counts = (n: number): UsageAnswer => new Map([["publish", { id: "publish", conversations: n, lastUsedAt: 1 }]]);
const rowTexts = (wrapper: ReturnType<typeof mount>) => wrapper.findAll("[data-testid=skills-usage]").map((row) => row.text());

beforeEach(() => {
  pending.length = 0;
  open.value = true;
});

describe("skill usage in the Skills viewer", () => {
  it("shows a count on a skill that ran and unused on one that did not", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    pending[0](counts(3));
    await flushPromises();
    expect(rowTexts(wrapper)).toEqual(["3×", "unused"]);
  });

  it("shows no count at all when the index could not answer", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    pending[0](null);
    await flushPromises();
    expect(rowTexts(wrapper)).toEqual([]);
  });

  it("keeps the newer opening's counts when the earlier one answers last", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    open.value = false;
    await flushPromises();
    open.value = true;
    await flushPromises();
    expect(pending).toHaveLength(2);
    pending[1](counts(5));
    pending[0](counts(1));
    await flushPromises();
    expect(rowTexts(wrapper)).toEqual(["5×", "unused"]);
  });

  // The screen is hidden, not thrown away: the skill picked and the search typed are there on the next
  // open, and the list stays on screen while the catalog is read again.
  it("keeps the pick and the search across a close, with the list shown while it is read again", async () => {
    const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.get("[data-testid=skills-search]").setValue("pub");
    await wrapper.get("[data-testid=skills-item]").trigger("click");
    await flushPromises();
    open.value = false;
    await flushPromises();
    open.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("[data-testid=skills-item]")).toHaveLength(1);
    expect(wrapper.get<HTMLInputElement>("[data-testid=skills-search]").element.value).toBe("pub");
    expect(wrapper.get("[data-testid=skills-item]").classes()).toContain("bg-hover");
  });
});
