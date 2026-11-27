// The new-build form offers only what can be used: the task comes first, grouped by where it runs, and the base only
// among those the task can be built on — not at all when there is one, so a document task is never offered a cloud
// platform.
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const packsRead = vi.hoisted(() => ({ failures: 0 }));
const { previewPair } = vi.hoisted(() => ({
  previewPair: vi.fn<(base: string, usecase: string) => Promise<unknown>>(async () => ({ ok: true, value: { hearing: { questions: [] }, steps: [] } })),
}));
vi.mock("../../../../src/composables/useBlueprintsView", () => ({ takeFormFill: () => null, keepFormFill: vi.fn() }));
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openTerminalAt: vi.fn() }));
const base = (slug: string, title: string, order?: number) => ({
  slug,
  manifest: { slug, kind: "base", title, version: "0.1.0", description: "", platform: "local", ...(order ? { order } : {}) },
});
const usecase = (slug: string, title: string, bases: string[]) => ({
  slug,
  manifest: { slug, kind: "usecase", title, version: "0.1.0", description: "", bases },
});
vi.mock("../../../../src/composables/blueprintsApi", () => ({
  listPacks: async () =>
    packsRead.failures-- > 0
      ? { ok: false, error: "the packs could not be read" }
      : {
          ok: true,
          value: {
            packs: [
              base("docs", "文書のフォルダ", 1),
              base("firebase", "Firebase"),
              base("local", "ローカル"),
              base("repo", "既存のリポジトリ"),
              usecase("review", "文書を読み解く", ["docs"]),
              usecase("polish", "文書を整える", ["docs"]),
              usecase("product", "自由に作る", ["local", "firebase", "supabase"]),
              usecase("from-collection", "コレクションから作る", ["local", "firebase"]),
              usecase("internal", "社内向け業務アプリ", ["firebase"]),
              usecase("refactor", "リファクタリング", ["repo"]),
            ],
          },
        },
  listPresets: async () => ({
    ok: true,
    value: { presets: [{ id: "library", title: "おうち図書館", description: "", base: "firebase", usecase: "product", answers: {}, samples: [] }] },
  }),
  previewPair,
  startRun: vi.fn(),
  suggestFolder: vi.fn(async () => ({ ok: true, value: { path: null } })),
  listKnownFolders: vi.fn(async () => ({ ok: true, value: { folders: [] } })),
}));

import BlueprintNewBuild from "../../../../src/components/blueprints/BlueprintNewBuild.vue";

const mountForm = async () => {
  const wrapper = mount(BlueprintNewBuild);
  await flushPromises();
  return wrapper;
};
const groupsOf = (wrapper: Awaited<ReturnType<typeof mountForm>>) =>
  wrapper
    .findAll('[data-testid="blueprint-usecase"] optgroup')
    .map((group) => [group.attributes("label"), group.findAll("option").map((option) => option.attributes("value"))]);
const baseOptions = (wrapper: Awaited<ReturnType<typeof mountForm>>) =>
  wrapper.findAll('[data-testid="blueprint-base"] option').map((option) => option.attributes("value"));

describe("choosing what to make", () => {
  it("lists every task, grouped by where it runs: documents first, then apps, then the rest", async () => {
    const wrapper = await mountForm();
    expect(groupsOf(wrapper)).toEqual([
      ["文書のフォルダ", ["review", "polish"]],
      ["Apps (choose the platform next)", ["product", "from-collection"]],
      ["Firebase", ["internal"]],
      ["既存のリポジトリ", ["refactor"]],
    ]);
  });

  it("starts on a document task with no base to choose", async () => {
    const wrapper = await mountForm();
    expect(wrapper.get<HTMLSelectElement>('[data-testid="blueprint-usecase"]').element.value).toBe("review");
    expect(wrapper.find('[data-testid="blueprint-base"]').exists()).toBe(false);
  });

  it("offers only the installed bases an app can be built on, and none again for a document task", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("product");
    await flushPromises();
    expect(baseOptions(wrapper)).toEqual(["firebase", "local"]);
    expect(previewPair).toHaveBeenLastCalledWith("firebase", "product");
    await wrapper.get('[data-testid="blueprint-base"]').setValue("local");
    await flushPromises();
    expect(previewPair).toHaveBeenLastCalledWith("local", "product");
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("polish");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-base"]').exists()).toBe(false);
    expect(previewPair).toHaveBeenLastCalledWith("docs", "polish");
  });

  it("keeps the base chosen when another task can be built on it too", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("product");
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-base"]').setValue("local");
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("from-collection");
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>('[data-testid="blueprint-base"]').element.value).toBe("local");
    expect(previewPair).toHaveBeenLastCalledWith("local", "from-collection");
  });

  it("builds a single-base task on its base without asking", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("refactor");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-base"]').exists()).toBe(false);
    expect(previewPair).toHaveBeenLastCalledWith("repo", "refactor");
  });

  it("takes an example's base and task together, even one of several bases", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLSelectElement>('[data-testid="blueprint-usecase"]').element.value).toBe("product");
    expect(wrapper.get<HTMLSelectElement>('[data-testid="blueprint-base"]').element.value).toBe("firebase");
    expect(previewPair).toHaveBeenLastCalledWith("firebase", "product");
  });
});

// The Blueprints screen is kept while closed: a form whose packs could not be read is set up once they can be.
describe("a form whose first read failed", () => {
  it("is set up, and the failure cleared, when the screen is shown again and the packs can be read", async () => {
    packsRead.failures = 1;
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintNewBuild, {});
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-new-error"]').exists()).toBe(true);
    await showAgain();
    expect(wrapper.find('[data-testid="blueprint-new-error"]').exists()).toBe(false);
    expect(wrapper.get<HTMLSelectElement>('[data-testid="blueprint-usecase"]').element.value).not.toBe("");
    wrapper.unmount();
  });
});

describe("the questions shown again", () => {
  it("are read again for the same pair, keeping the answers given", async () => {
    const question = (id: string) => ({ id, label: id, why: "", kind: "text" });
    previewPair.mockResolvedValue({ ok: true, value: { hearing: { questions: [question("goal")] }, steps: [] } });
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintNewBuild, {});
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-question"] textarea').setValue("a tidy report");
    previewPair.mockClear();
    previewPair.mockResolvedValue({ ok: true, value: { hearing: { questions: [question("goal"), question("audience")] }, steps: [] } });
    await showAgain();
    expect(previewPair).toHaveBeenCalledTimes(1);
    const fields = wrapper.findAll('[data-testid="blueprint-question"]');
    expect(fields.map((field) => field.get("label").text().split(" ")[0])).toEqual(["goal", "audience"]);
    expect(fields[0]?.get<HTMLTextAreaElement>("textarea").element.value).toBe("a tidy report");
    wrapper.unmount();
  });
});
