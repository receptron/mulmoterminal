// The new-build form and an example that brings sample documents: it says which files it will place, sends the
// example's id when the build starts, and forgets the example when the pair is changed by hand.
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { provideOverlayVisible } from "../../../../src/composables/overlayVisibility";
import type { FormFill } from "../../../../src/composables/useBlueprintsView";

const { startRun, suggestFolder, listKnownFolders } = vi.hoisted(() => ({ startRun: vi.fn(), suggestFolder: vi.fn(), listKnownFolders: vi.fn() }));
const { takeFormFill } = vi.hoisted(() => ({ takeFormFill: vi.fn((): FormFill | null => null) }));
const { keepFormFill, openTerminalAt } = vi.hoisted(() => ({ keepFormFill: vi.fn(), openTerminalAt: vi.fn() }));
vi.mock("../../../../src/composables/useBlueprintsView", () => ({ takeFormFill, keepFormFill }));
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openTerminalAt }));
vi.mock("../../../../src/composables/blueprintsApi", () => ({
  listPacks: async () => ({
    ok: true,
    value: {
      packs: [
        { slug: "docs", manifest: { slug: "docs", kind: "base", title: "文書のフォルダ", version: "0.1.0", description: "", platform: "local" } },
        { slug: "local", manifest: { slug: "local", kind: "base", title: "ローカル", version: "0.1.0", description: "", platform: "local" } },
        { slug: "review", manifest: { slug: "review", kind: "usecase", title: "文書を読み解く", version: "0.1.0", description: "", bases: ["docs"] } },
        { slug: "ask", manifest: { slug: "ask", kind: "usecase", title: "文書に尋ねる", version: "0.1.0", description: "", bases: ["docs"] } },
      ],
    },
  }),
  listPresets: async () => ({
    ok: true,
    value: {
      presets: [
        {
          id: "itaku-keiyaku",
          title: "業務委託契約書を読み解く",
          description: "",
          base: "docs",
          usecase: "review",
          answers: { documents: "contract.txt" },
          samples: ["contract.txt"],
        },
        {
          id: "keihi",
          title: "経費精算の手引きに尋ねる",
          description: "",
          base: "docs",
          usecase: "ask",
          answers: { documents: "keihi.md" },
          samples: ["keihi.md"],
        },
        { id: "home-library", title: "おうち図書館", description: "", base: "local", usecase: "product", answers: {}, samples: [] },
      ],
    },
  }),
  // The ask interview has a question with a default, for the form to start from.
  previewPair: async (_base: string, usecase: string) => ({
    ok: true,
    value: {
      hearing: {
        questions: [
          { id: "documents", label: "文書", why: "", kind: "text" },
          ...(usecase === "ask" ? [{ id: "limit", label: "上限", why: "", kind: "number", required: true, default: 5 }] : []),
        ],
      },
      steps: [],
    },
  }),
  startRun,
  suggestFolder,
  listKnownFolders,
}));

import BlueprintNewBuild from "../../../../src/components/blueprints/BlueprintNewBuild.vue";
import { en } from "../../../../src/i18n/en";

// jsdom lays nothing out and has no scrollIntoView; the element it is called on is what the form means to show.
const scrollIntoView = vi.fn();
beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
beforeEach(() => {
  scrollIntoView.mockReset();
});
const scrolledTo = (): string[] => scrollIntoView.mock.contexts.map((element) => (element instanceof Element ? (element.textContent?.trim() ?? "") : ""));

const mountForm = async () => {
  const wrapper = mount(BlueprintNewBuild);
  await flushPromises();
  return wrapper;
};

describe("the report language", () => {
  beforeEach(() => {
    startRun.mockReset();
    startRun.mockResolvedValue({ ok: true, value: { runId: "run-1" } });
    suggestFolder.mockReset();
    suggestFolder.mockResolvedValue({ ok: true, value: { path: null } });
    listKnownFolders.mockReset();
    listKnownFolders.mockResolvedValue({ ok: true, value: { folders: [] } });
  });

  const startWith = async (pick: string | null) => {
    const wrapper = await mountForm();
    if (pick !== null) await wrapper.get('[data-testid="blueprint-report-language"]').setValue(pick);
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/tmp/example");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    return wrapper;
  };

  it("offers every language a build can record, each named in its own words", async () => {
    const wrapper = await mountForm();
    const options = wrapper.findAll('[data-testid="blueprint-report-language"] option');
    expect(options.map((option) => option.attributes("value"))).toEqual(["en", "ja", "zh-CN", "zh-TW", "ko"]);
    expect(options.map((option) => option.text())).toEqual(["English", "日本語", "简体中文", "繁體中文", "한국어"]);
  });

  it("starts as the screen's language and is sent as it is", async () => {
    await startWith(null);
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
  });

  it("sends the language the person picked instead of the screen's", async () => {
    await startWith("ja");
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ language: "ja" }));
  });
});

describe("starting a document blueprint from an example", () => {
  beforeEach(() => {
    startRun.mockReset();
    startRun.mockResolvedValue({ ok: true, value: { runId: "run-1" } });
    suggestFolder.mockReset();
    suggestFolder.mockResolvedValue({ ok: true, value: { path: null } });
    listKnownFolders.mockReset();
    listKnownFolders.mockResolvedValue({ ok: true, value: { folders: [] } });
  });

  it("names the sample documents and sends the example's id", async () => {
    const wrapper = await mountForm();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-preset-samples"]').text()).toContain("contract.txt");
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/tmp/example");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ base: "docs", usecase: "review", preset: "itaku-keiyaku", language: "en" }));
  });

  it("forgets the example, and its samples, when the usecase is changed by hand", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("ask");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-preset-samples"]').exists()).toBe(false);
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/tmp/example");
    await wrapper.findComponent({ name: "BlueprintHearingField" }).vm.$emit("update", "contract.txt");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun.mock.calls[0]?.[0]).toEqual({
      projectDir: "/tmp/example",
      base: "docs",
      usecase: "ask",
      answers: { limit: 5, documents: "contract.txt" },
      language: "en",
    });
  });

  it("words a refusal from its code, not from the server's English", async () => {
    startRun.mockResolvedValue({ ok: false, error: "server English", refusal: { code: "samples-clash", files: ["contract.txt"] } });
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/tmp/example");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(wrapper.get('[data-testid="blueprint-new-error"]').text()).toBe(en.blueprints.refusals.samplesClash.replace("{files}", "contract.txt"));
  });

  it("offers a new folder for the example when none is typed, and says so while it is unchanged", async () => {
    suggestFolder.mockResolvedValue({ ok: true, value: { path: "/Users/me/work/itaku-keiyaku" } });
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    expect(suggestFolder).toHaveBeenCalledWith("itaku-keiyaku");
    const field = wrapper.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]');
    expect(field.element.value).toBe("/Users/me/work/itaku-keiyaku");
    expect(wrapper.find('[data-testid="blueprint-folder-suggested"]').exists()).toBe(true);
    await field.setValue("/Users/me/elsewhere");
    expect(wrapper.find('[data-testid="blueprint-folder-suggested"]').exists()).toBe(false);
  });

  it("never replaces a folder the person typed, even one typed while the suggestion was on its way", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/Users/me/mine");
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    expect(suggestFolder).not.toHaveBeenCalled();

    const settle: { answer: (value: unknown) => void } = { answer: () => undefined };
    suggestFolder.mockReturnValue(new Promise((resolve) => (settle.answer = resolve)));
    const late = await mountForm();
    await late.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await late.get('[data-testid="blueprint-project-dir"]').setValue("/Users/me/typed");
    settle.answer({ ok: true, value: { path: "/Users/me/work/itaku-keiyaku" } });
    await flushPromises();
    expect(late.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value).toBe("/Users/me/typed");
  });

  it("keeps only the latest example's suggestion when examples are switched quickly", async () => {
    const first: { answer: (value: unknown) => void } = { answer: () => undefined };
    suggestFolder.mockReturnValueOnce(new Promise((resolve) => (first.answer = resolve))).mockResolvedValueOnce({ ok: true, value: { path: null } });
    const wrapper = await mountForm();
    const [contract, keihi] = wrapper.findAll('[data-testid="blueprint-preset-use"]');
    await contract?.trigger("click");
    await keihi?.trigger("click");
    await flushPromises();
    first.answer({ ok: true, value: { path: "/Users/me/work/itaku-keiyaku" } });
    await flushPromises();
    // The second example found no place; the first one's late answer must not fill the field for it.
    expect(wrapper.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value).toBe("");
  });

  it("replaces an earlier example's folder it filled in itself, and drops it when the next example has none", async () => {
    suggestFolder
      .mockResolvedValueOnce({ ok: true, value: { path: "/Users/me/work/itaku-keiyaku" } })
      .mockResolvedValueOnce({ ok: true, value: { path: "/Users/me/work/keihi" } })
      .mockResolvedValueOnce({ ok: true, value: { path: null } });
    const wrapper = await mountForm();
    const [contract, keihi] = wrapper.findAll('[data-testid="blueprint-preset-use"]');
    const field = () => wrapper.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value;
    await contract?.trigger("click");
    await flushPromises();
    expect(field()).toBe("/Users/me/work/itaku-keiyaku");
    await keihi?.trigger("click");
    await flushPromises();
    expect(field()).toBe("/Users/me/work/keihi");
    await contract?.trigger("click");
    await flushPromises();
    expect(field()).toBe("");
    expect(wrapper.find('[data-testid="blueprint-folder-suggested"]').exists()).toBe(false);
  });

  it("does not fill a late suggestion in once the pair was changed by hand", async () => {
    const late: { answer: (value: unknown) => void } = { answer: () => undefined };
    suggestFolder.mockReturnValueOnce(new Promise((resolve) => (late.answer = resolve)));
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("ask");
    await flushPromises();
    late.answer({ ok: true, value: { path: "/Users/me/work/itaku-keiyaku" } });
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value).toBe("");
  });

  it("keeps a filled-in folder but drops its note once the pair is changed by hand", async () => {
    suggestFolder.mockResolvedValue({ ok: true, value: { path: "/Users/me/work/itaku-keiyaku" } });
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-folder-suggested"]').exists()).toBe(true);
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("ask");
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value).toBe("/Users/me/work/itaku-keiyaku");
    expect(wrapper.find('[data-testid="blueprint-folder-suggested"]').exists()).toBe(false);
  });
});

describe("opening the form as a finished build's next step", () => {
  const FOLLOW_UP = { base: "docs", usecase: "ask", answers: { documents: "keihi.md" }, projectDir: "/work/docs", after: "規約をつくる" };

  beforeEach(() => {
    startRun.mockReset();
    startRun.mockResolvedValue({ ok: true, value: { runId: "run-2" } });
    suggestFolder.mockReset();
    takeFormFill.mockReturnValueOnce(FOLLOW_UP);
  });

  it("fills the folder, the pair and the answers, says what it continues, and starts without an example", async () => {
    const wrapper = await mountForm();
    expect(wrapper.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value).toBe("/work/docs");
    expect(wrapper.get<HTMLSelectElement>('[data-testid="blueprint-usecase"]').element.value).toBe("ask");
    expect(wrapper.get('[data-testid="blueprint-follow-up"]').text()).toContain("規約をつくる");
    expect(wrapper.find('[data-testid="blueprint-form-restored"]').exists()).toBe(false);
    expect(scrolledTo()).toEqual([wrapper.get('[data-testid="blueprint-follow-up"]').text()]);
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledWith({
      projectDir: "/work/docs",
      base: "docs",
      usecase: "ask",
      answers: { limit: 5, documents: "keihi.md" },
      language: "en",
    });
  });

  it("leaves out an answer the form's interview would not take", async () => {
    takeFormFill.mockReset();
    takeFormFill.mockReturnValueOnce({ ...FOLLOW_UP, answers: { documents: "keihi.md", style: "no such question", extra: 1 } });
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ answers: { limit: 5, documents: "keihi.md" } }));
  });

  it("drops the note when the pair is changed by hand, and is not offered again when the form opens next", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("review");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-follow-up"]').exists()).toBe(false);
    const again = await mountForm();
    expect(again.find('[data-testid="blueprint-follow-up"]').exists()).toBe(false);
    expect(again.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value).toBe("");
  });
});

describe("the examples, by base", () => {
  it("shows each base's examples under its title, and only those", async () => {
    const wrapper = await mountForm();
    const groups = wrapper.findAll('[data-testid="blueprint-preset-group"]');
    expect(groups.map((group) => group.get("h4").text())).toEqual(["文書のフォルダ", "ローカル"]);
    expect(groups.map((group) => group.findAll('[data-testid="blueprint-preset"]').length)).toEqual([2, 1]);
  });
});

describe("the folders the form offers to pick", () => {
  beforeEach(() => {
    listKnownFolders.mockReset();
  });

  it("offers each known folder on the folder field, and says it can be picked", async () => {
    listKnownFolders.mockResolvedValue({ ok: true, value: { folders: ["/Users/me/docs", "/Users/me/work"] } });
    const wrapper = await mountForm();
    const field = wrapper.get('[data-testid="blueprint-project-dir"]');
    const list = wrapper.get('[data-testid="blueprint-known-folders"]');
    expect(field.attributes("list")).toBe(list.attributes("id"));
    expect(list.findAll("option").map((option) => option.attributes("value"))).toEqual(["/Users/me/docs", "/Users/me/work"]);
    expect(field.attributes("placeholder")).toBe(en.blueprints.form.projectDirPick);
  });

  it("offers nothing, and says nothing about picking, when there is nothing known or the list cannot be read", async () => {
    listKnownFolders.mockResolvedValue({ ok: false, status: 500, error: "down" });
    const wrapper = await mountForm();
    expect(wrapper.findAll('[data-testid="blueprint-known-folders"] option')).toHaveLength(0);
    expect(wrapper.get('[data-testid="blueprint-project-dir"]').attributes("placeholder") ?? "").toBe("");
  });
});

describe("a folder Claude Code does not trust yet", () => {
  const UNTRUSTED = { ok: false, error: "untrusted", refusal: { code: "untrusted", dir: "/Users/me/new", trustIn: "/Users/me" } };

  beforeEach(() => {
    startRun.mockReset();
    suggestFolder.mockReset();
    suggestFolder.mockResolvedValue({ ok: true, value: { path: null } });
    keepFormFill.mockReset();
    openTerminalAt.mockReset();
  });

  const refusedOnExample = async () => {
    startRun.mockResolvedValueOnce(UNTRUSTED);
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/Users/me/new");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    return wrapper;
  };

  it("offers to open Claude Code where the prompt is answered, keeping the form, example included, for when it opens again", async () => {
    const wrapper = await refusedOnExample();
    expect(wrapper.get('[data-testid="blueprint-trust"]').text()).toContain("/Users/me");
    await wrapper.get('[data-testid="blueprint-open-trust"]').trigger("click");
    expect(keepFormFill).toHaveBeenCalledWith({
      base: "docs",
      usecase: "review",
      answers: { documents: "contract.txt" },
      projectDir: "/Users/me/new",
      preset: "itaku-keiyaku",
      language: "en",
    });
    expect(openTerminalAt).toHaveBeenCalledWith("/Users/me", null, "claude");
  });

  it("keeps the report language the person picked with the form", async () => {
    const wrapper = await refusedOnExample();
    await wrapper.get('[data-testid="blueprint-report-language"]').setValue("ja");
    await wrapper.get('[data-testid="blueprint-open-trust"]').trigger("click");
    expect(keepFormFill).toHaveBeenCalledWith(expect.objectContaining({ language: "ja" }));
  });

  it("starts a kept or follow-up form with the language it carries", async () => {
    takeFormFill.mockReturnValueOnce({ base: "docs", usecase: "review", answers: { documents: "contract.txt" }, projectDir: "/Users/me/new", language: "ja" });
    startRun.mockResolvedValueOnce({ ok: true, value: { runId: "run-4" } });
    const wrapper = await mountForm();
    expect(wrapper.get<HTMLSelectElement>('[data-testid="blueprint-report-language"]').element.value).toBe("ja");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ language: "ja" }));
  });

  it("stops offering it once another folder is typed, and never offers it for another refusal", async () => {
    const wrapper = await refusedOnExample();
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/Users/me/other");
    expect(wrapper.find('[data-testid="blueprint-open-trust"]').exists()).toBe(false);
    startRun.mockResolvedValueOnce({ ok: false, error: "busy", refusal: { code: "folder-busy", dir: "/Users/me/other", runId: "run-1" } });
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-new-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="blueprint-open-trust"]').exists()).toBe(false);
  });

  it("puts the kept form back when it opens again, says so, and starts with the same example", async () => {
    takeFormFill.mockReturnValueOnce({
      base: "docs",
      usecase: "review",
      answers: { documents: "contract.txt" },
      projectDir: "/Users/me/new",
      preset: "itaku-keiyaku",
    });
    startRun.mockResolvedValueOnce({ ok: true, value: { runId: "run-3" } });
    const wrapper = await mountForm();
    expect(wrapper.get<HTMLInputElement>('[data-testid="blueprint-project-dir"]').element.value).toBe("/Users/me/new");
    expect(wrapper.find('[data-testid="blueprint-form-restored"]').exists()).toBe(true);
    expect(scrolledTo()).toEqual([wrapper.get('[data-testid="blueprint-form-restored"]').text()]);
    expect(wrapper.find('[data-testid="blueprint-follow-up"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="blueprint-preset-samples"]').text()).toContain("contract.txt");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledWith({
      projectDir: "/Users/me/new",
      base: "docs",
      usecase: "review",
      answers: { documents: "contract.txt" },
      preset: "itaku-keiyaku",
      language: "en",
    });
  });
});

describe("a question with a default", () => {
  beforeEach(() => {
    startRun.mockReset();
    startRun.mockResolvedValue({ ok: true, value: { runId: "run-4" } });
    suggestFolder.mockReset();
    suggestFolder.mockResolvedValue({ ok: true, value: { path: null } });
  });

  const startWith = async (wrapper: Awaited<ReturnType<typeof mountForm>>) => {
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/tmp/example");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    return startRun.mock.calls.at(-1)?.[0];
  };

  it("starts with the default when the usecase is chosen by hand, and is sent with the rest", async () => {
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("ask");
    await flushPromises();
    await wrapper.findComponent({ name: "BlueprintHearingField" }).vm.$emit("update", "keihi.md");
    expect(await startWith(wrapper)).toEqual(expect.objectContaining({ answers: { limit: 5, documents: "keihi.md" } }));
  });

  it("keeps the default beside an example's answers, and goes when the pair changes to one without it", async () => {
    const wrapper = await mountForm();
    await wrapper.findAll('[data-testid="blueprint-preset-use"]')[1]?.trigger("click");
    await flushPromises();
    expect((await startWith(wrapper))?.answers).toEqual({ limit: 5, documents: "keihi.md" });
    await wrapper.get('[data-testid="blueprint-usecase"]').setValue("review");
    await flushPromises();
    await wrapper.findComponent({ name: "BlueprintHearingField" }).vm.$emit("update", "contract.txt");
    expect((await startWith(wrapper))?.answers).toEqual({ documents: "contract.txt" });
  });

  it("gives way to a hand-over that answers the same question", async () => {
    takeFormFill.mockReturnValueOnce({
      base: "docs",
      usecase: "ask",
      answers: { documents: "keihi.md", limit: 2 },
      projectDir: "/work/docs",
      after: "規約をつくる",
    });
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ answers: { limit: 2, documents: "keihi.md" } }));
  });
});

describe("a source that carries personal data", () => {
  const FIELD = { collection: "people", field: "email", label: "Email" };
  const PERSONAL = { ok: false, error: "personal data", refusal: { code: "personal-data", fields: [FIELD], members: 2 } };

  beforeEach(() => {
    startRun.mockReset();
    suggestFolder.mockReset();
    suggestFolder.mockResolvedValue({ ok: true, value: { path: null } });
  });

  const refused = async () => {
    startRun.mockResolvedValueOnce(PERSONAL);
    const wrapper = await mountForm();
    await wrapper.get('[data-testid="blueprint-preset-use"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/Users/me/new");
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    return wrapper;
  };

  it("names what it would copy, and starts again with the same answers once it is confirmed", async () => {
    const wrapper = await refused();
    expect(startRun.mock.calls[0][0]).not.toHaveProperty("personalDataConfirmed");
    expect(wrapper.get('[data-testid="blueprint-new-error"]').text()).toContain("Email (people.email)");
    startRun.mockResolvedValueOnce({ ok: true, value: { runId: "run-9" } });
    await wrapper.get('[data-testid="blueprint-copy-personal-data"]').trigger("click");
    await flushPromises();
    expect(startRun.mock.calls[1][0]).toEqual({ ...startRun.mock.calls[0][0], personalDataConfirmed: true });
  });

  it("stops offering to confirm once an answer changes: the list was of what the old answers would copy", async () => {
    const wrapper = await refused();
    await wrapper.get('[data-testid="blueprint-question"] textarea').setValue("other.txt");
    await flushPromises();
    expect(wrapper.find('[data-testid="blueprint-copy-personal-data"]').exists()).toBe(false);
  });
});

// The Blueprints screen is kept while closed, so the form is still filled in after a trip to a terminal;
// the copy kept for a reload is spent on coming back, so it cannot fill a later new build.
describe("the form shown again", () => {
  it("spends the kept copy and reads the lists again each time the screen is shown again", async () => {
    takeFormFill.mockClear();
    listKnownFolders.mockReset();
    listKnownFolders.mockResolvedValue({ ok: true, value: { folders: [] } });
    const visible = ref(true);
    const Host = defineComponent({ setup: () => (provideOverlayVisible(visible), () => h(BlueprintNewBuild)) });
    const wrapper = mount(Host);
    await flushPromises();
    expect(takeFormFill).toHaveBeenCalledTimes(1);
    visible.value = false;
    await flushPromises();
    visible.value = true;
    await flushPromises();
    expect(takeFormFill).toHaveBeenCalledTimes(2);
    expect(listKnownFolders).toHaveBeenCalledTimes(2); // the lists are read again too
    wrapper.unmount();
  });
});
