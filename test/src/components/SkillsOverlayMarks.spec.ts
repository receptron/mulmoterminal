// Each evaluated skill's mark in the Skills viewer's list (#3467), and the filter down to the skills that call for
// something: not helping, not measured as they are now, or used and never evaluated.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import type { SkillUsage } from "../../../common/skillUsage";
import { markKey, type SkillEvalMark } from "../../../common/skillEvalMark";
import { skillsViewEn } from "../../../src/i18n/skillsView/en";

const open = ref(true);
vi.mock("../../../src/composables/useSkillsView", () => ({ useSkillsView: () => ({ isOpen: open, close: () => {} }) }));

const skill = (id: string) => ({ slug: id, id, description: "", overridesUser: false });
const catalog = {
  sources: [
    { scope: "user", dir: "/h/.claude/skills", plugin: "", skills: [skill("helps"), skill("flat"), skill("stale"), skill("used"), skill("idle")] },
    { scope: "project", dir: "/p", plugin: "", skills: [skill("helps")] },
  ],
};
let usage: ReadonlyMap<string, SkillUsage> | null = null;
let marks: ReadonlyMap<string, SkillEvalMark> | null = null;
vi.mock("../../../src/composables/useSkillCatalog", () => ({
  loadSkillCatalog: () => Promise.resolve(catalog),
  loadSkillDoc: () => Promise.resolve(null),
  loadSkillUsage: () => Promise.resolve(usage),
}));
vi.mock("../../../src/composables/skillEvalApi", () => ({ loadSkillEvalMarks: () => Promise.resolve(marks) }));
const SkillsOverlay = (await import("../../../src/components/SkillsOverlay.vue")).default;

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: skillsViewEn } });
const mountOverlay = async () => {
  const wrapper = mount(SkillsOverlay, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
};
const rows = (wrapper: Awaited<ReturnType<typeof mountOverlay>>) =>
  wrapper.findAll("[data-testid=skills-item]").map((row) => {
    const mark = row.find("[data-testid=skills-eval-mark]");
    return [row.find(".font-mono").text(), mark.exists() ? mark.text() : null];
  });

beforeEach(() => {
  open.value = true;
  usage = new Map([["used", { id: "used", conversations: 4, lastUsedAt: 1 }]]);
  marks = new Map<string, SkillEvalMark>([
    [markKey("helps", null), "helps"],
    [markKey("flat", null), "no-evidence"],
    [markKey("stale", null), "unmeasured"],
    // The project's skill of the same name is another skill, with a mark of its own.
    [markKey("helps", "/p"), "hurts"],
  ]);
});

describe("evaluation marks in the Skills viewer", () => {
  it("marks each evaluated skill and leaves the others plain", async () => {
    const wrapper = await mountOverlay();
    expect(rows(wrapper)).toEqual([
      ["helps", "helps"],
      ["flat", "no difference"],
      ["stale", "not measured"],
      ["used", null],
      ["idle", null],
    ]);
    await wrapper.findAll("[data-testid=skills-source]")[1]?.trigger("click");
    expect(rows(wrapper)).toEqual([["helps", "makes worse"]]);
  });

  it("filters down to the skills that need attention, and back", async () => {
    const wrapper = await mountOverlay();
    await wrapper.find("[data-testid=skills-attention]").trigger("click");
    expect(rows(wrapper).map(([id]) => id)).toEqual(["flat", "stale", "used"]);
    // The project's skill makes things worse, so its place stays listed.
    expect(wrapper.findAll("[data-testid=skills-source]")).toHaveLength(2);
    await wrapper.find("[data-testid=skills-attention]").trigger("click");
    expect(rows(wrapper)).toHaveLength(5);
  });

  it("says so when no skill needs attention", async () => {
    marks = new Map<string, SkillEvalMark>([[markKey("helps", null), "helps"]]);
    usage = null;
    const wrapper = await mountOverlay();
    await wrapper.find("[data-testid=skills-attention]").trigger("click");
    expect(wrapper.find("[data-testid=skills-no-match]").text()).toBe("No skill needs attention.");
  });

  it("shows no marks and no filter when they could not be read", async () => {
    marks = null;
    const wrapper = await mountOverlay();
    expect(wrapper.find("[data-testid=skills-eval-mark]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=skills-attention]").exists()).toBe(false);
  });
});
