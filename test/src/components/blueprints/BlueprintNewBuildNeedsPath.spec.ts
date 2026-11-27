// An option that needs a file in the folder is offered only where that file is, and a question left with one option
// is not asked: that option is the answer, and the questions it opens are asked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const FOLDER_STYLE = "このフォルダの規約";
const DEFAULT_STYLE = "chaff の既定のまま";
const HEARING = {
  questions: [
    {
      id: "style",
      label: "Style",
      why: "which rules",
      kind: "select",
      required: true,
      options: [FOLDER_STYLE, DEFAULT_STYLE],
      needsPath: { [FOLDER_STYLE]: "chaff.yaml" },
    },
    { id: "voice", label: "Voice", why: "tone", kind: "select", required: false, options: ["mine", "polite", "plain"], needsPath: { mine: "VOICE.md" } },
    { id: "kind", label: "Kind", why: "genre", kind: "select", required: true, options: ["報告書", "ブログ"], showIf: { id: "style", equals: DEFAULT_STYLE } },
  ],
};
const { folderPresentPaths, startRun } = vi.hoisted(() => ({
  folderPresentPaths: vi.fn<(dir: string, files: readonly string[]) => Promise<unknown>>(async () => ({ ok: true, value: { present: [] } })),
  startRun: vi.fn<(request: unknown) => Promise<unknown>>(async () => ({ ok: true, value: { runId: "r1" } })),
}));
vi.mock("../../../../src/composables/useBlueprintsView", () => ({ takeFormFill: () => null, keepFormFill: vi.fn() }));
vi.mock("../../../../src/composables/useNewTerminal", () => ({ openTerminalAt: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", () => ({
  listPacks: async () => ({
    ok: true,
    value: {
      packs: [
        { slug: "docs", manifest: { slug: "docs", kind: "base", title: "文書のフォルダ", version: "0.1.0", description: "", platform: "local" } },
        { slug: "polish", manifest: { slug: "polish", kind: "usecase", title: "文書を整える", version: "0.1.0", description: "", bases: ["docs"] } },
      ],
    },
  }),
  listPresets: async () => ({ ok: true, value: { presets: [] } }),
  previewPair: async () => ({ ok: true, value: { hearing: HEARING, steps: [] } }),
  folderPresentPaths,
  startRun,
  suggestFolder: vi.fn(async () => ({ ok: true, value: { path: null } })),
  listKnownFolders: vi.fn(async () => ({ ok: true, value: { folders: [] } })),
}));

import BlueprintNewBuild from "../../../../src/components/blueprints/BlueprintNewBuild.vue";

const PRESENCE_SETTLED_MS = 400;
const inFolder = async (present: string[] | null) => {
  folderPresentPaths.mockResolvedValue(present === null ? { ok: false, value: { present: [] } } : { ok: true, value: { present } });
  const wrapper = mount(BlueprintNewBuild);
  await flushPromises();
  await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/home/me/notes");
  await new Promise((resolve) => setTimeout(resolve, PRESENCE_SETTLED_MS));
  await flushPromises();
  return wrapper;
};
const asked = (wrapper: Pick<VueWrapper, "findAll">) =>
  wrapper
    .findAll('[data-testid="blueprint-question"]')
    .map((question) => [
      question.get("label").text(),
      question.findAll("option").flatMap((option) => (option.attributes("disabled") === undefined ? [option.attributes("value")] : [])),
    ]);

beforeEach(() => {
  folderPresentPaths.mockClear();
  startRun.mockClear();
});

describe("an option that needs a file in the folder", () => {
  it("asks which rules where the folder has chaff.yaml", async () => {
    const wrapper = await inFolder(["chaff.yaml", "VOICE.md"]);
    expect(folderPresentPaths).toHaveBeenLastCalledWith("/home/me/notes", ["chaff.yaml", "VOICE.md"]);
    expect(asked(wrapper)).toEqual([
      ["Style", [FOLDER_STYLE, DEFAULT_STYLE]],
      ["Voice (optional)", ["mine", "polite", "plain"]],
    ]);
    expect(wrapper.get<HTMLButtonElement>('[data-testid="blueprint-start"]').element.disabled).toBe(true);
  });

  it("does not ask where it has none, and goes on to what chaff's default opens", async () => {
    const wrapper = await inFolder([]);
    expect(asked(wrapper)).toEqual([
      ["Voice (optional)", ["polite", "plain"]],
      ["Kind", ["報告書", "ブログ"]],
    ]);
    await wrapper.findAll('[data-testid="blueprint-question"] select')[1]?.setValue("ブログ");
    expect(wrapper.get<HTMLButtonElement>('[data-testid="blueprint-start"]').element.disabled).toBe(false);
    await wrapper.get('[data-testid="blueprint-new-form"]').trigger("submit");
    await flushPromises();
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ answers: { style: DEFAULT_STYLE, kind: "ブログ" } }));
  });

  it("offers every option when the folder could not be looked at, and leaves the server to refuse", async () => {
    const wrapper = await inFolder(null);
    expect(asked(wrapper)).toEqual([
      ["Style", [FOLDER_STYLE, DEFAULT_STYLE]],
      ["Voice (optional)", ["mine", "polite", "plain"]],
    ]);
  });
});

// The form is kept while the Blueprints screen is closed, and the folder may change meanwhile.
describe("the folder shown again", () => {
  it("is asked about again, and the options follow the answer", async () => {
    folderPresentPaths.mockResolvedValue({ ok: true, value: { present: [] } });
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintNewBuild, {});
    await flushPromises();
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/home/me/notes");
    await new Promise((resolve) => setTimeout(resolve, PRESENCE_SETTLED_MS));
    await flushPromises();
    expect(asked(wrapper)[0]?.[0]).toBe("Voice (optional)");
    folderPresentPaths.mockResolvedValue({ ok: true, value: { present: ["chaff.yaml", "VOICE.md"] } });
    await showAgain();
    expect(asked(wrapper)[0]?.[0]).toBe("Style");
    wrapper.unmount();
  });
});

describe("a folder typed just before the screen closes", () => {
  it("is not asked about while hidden", async () => {
    const { wrapper, visible } = mountUnderOverlay(BlueprintNewBuild, {});
    await flushPromises();
    folderPresentPaths.mockClear();
    await wrapper.get('[data-testid="blueprint-project-dir"]').setValue("/home/me/notes");
    visible.value = false;
    await new Promise((resolve) => setTimeout(resolve, PRESENCE_SETTLED_MS));
    await flushPromises();
    expect(folderPresentPaths).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
