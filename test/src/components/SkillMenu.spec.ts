import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SkillMenu from "../../../src/components/../../src/components/SkillMenu.vue";

type Skill = { slug: string; description: string };

function mockFetch(skills: Skill[], cwd = "/home/me/proj") {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ cwd, skills }) })) as unknown as typeof fetch;
}

const SKILLS: Skill[] = [
  { slug: "commit", description: "Write a commit message" },
  { slug: "review", description: "Review the current diff" },
];

const mountMenu = async () => {
  const w = mount(SkillMenu, { props: { cwd: "/proj" } });
  await flushPromises(); // skills fetch up front (decides whether the button shows)
  return w;
};

describe("SkillMenu", () => {
  beforeEach(() => mockFetch(SKILLS));

  it("shows the trigger once the project's skills have loaded", async () => {
    const w = await mountMenu();
    expect(w.find(".skill-trigger").exists()).toBe(true);
    expect(w.find(".skill-pop").exists()).toBe(false); // closed until clicked
  });

  it("renders nothing when the project has no skills (no skills, no button)", async () => {
    mockFetch([]);
    const w = await mountMenu();
    expect(w.find(".skill-trigger").exists()).toBe(false);
    expect(w.find(".skill-menu").exists()).toBe(false);
  });

  it("does not fetch (no button) while cwd is unresolved, avoiding default-workspace skills", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const w = mount(SkillMenu, { props: { cwd: null } });
    await flushPromises();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(w.find(".skill-trigger").exists()).toBe(false);
  });

  it("lists the skills when opened, with the description as tooltip", async () => {
    const w = await mountMenu();
    await w.find(".skill-trigger").trigger("click");
    const items = w.findAll(".skill-item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("commit");
    expect(items[0].attributes("title")).toBe("Write a commit message");
  });

  it("closes when cwd changes and does not reappear pre-opened", async () => {
    const w = await mountMenu();
    await w.find(".skill-trigger").trigger("click");
    expect(w.find(".skill-pop").exists()).toBe(true);

    await w.setProps({ cwd: null }); // unresolved → cleared + closed
    await flushPromises();
    expect(w.find(".skill-menu").exists()).toBe(false);

    await w.setProps({ cwd: "/proj2" }); // resolves again
    await flushPromises();
    expect(w.find(".skill-trigger").exists()).toBe(true);
    expect(w.find(".skill-pop").exists()).toBe(false); // not pre-opened
  });

  it("emits the picked skill's slug, then closes", async () => {
    const w = await mountMenu();
    await w.find(".skill-trigger").trigger("click");
    await w.findAll(".skill-item")[1].trigger("click");
    expect(w.emitted("skill")?.[0]?.[0]).toBe("review");
    expect(w.find(".skill-pop").exists()).toBe(false); // closed after picking
  });
});
