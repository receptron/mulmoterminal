// Picking a question's files from the folder: the list comes from the folder the form names, a click adds or removes
// a line, and a list read for another folder is not offered.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { mountUnderOverlay } from "../underOverlay";

const { listFolderFiles } = vi.hoisted(() => ({ listFolderFiles: vi.fn() }));
vi.mock("../../../../src/composables/blueprintsApi", () => ({ listFolderFiles }));

import BlueprintFilePicker from "../../../../src/components/blueprints/BlueprintFilePicker.vue";
import { en } from "../../../../src/i18n/en";

const pick = (projectDir: string, answer = "") => mount(BlueprintFilePicker, { props: { projectDir, answer } });

describe("picking files from the folder", () => {
  beforeEach(() => {
    listFolderFiles.mockReset();
    listFolderFiles.mockResolvedValue({ ok: true, value: { files: ["contract.txt", "notes/memo.md"], more: false } });
  });

  it("asks for a folder first", () => {
    const wrapper = pick("  ");
    expect(wrapper.get('[data-testid="blueprint-pick-files"]').attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(en.blueprints.form.pickNeedsFolder);
  });

  it("lists the folder's files, marks the ones already in the answer, and adds or removes a line on a click", async () => {
    const wrapper = pick("/work/docs", "contract.txt");
    await wrapper.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    expect(listFolderFiles).toHaveBeenCalledWith("/work/docs");
    const files = wrapper.findAll('[data-testid="blueprint-pick-file"]');
    expect(files.map((file) => [file.text(), file.attributes("aria-pressed")])).toEqual([
      ["contract.txt", "true"],
      ["notes/memo.md", "false"],
    ]);
    await files[1]?.trigger("click");
    await files[0]?.trigger("click");
    expect(wrapper.emitted("update")).toEqual([["contract.txt\nnotes/memo.md"], [undefined]]);
  });

  it("leaves out a file whose name has a line break, which one line of the answer cannot hold", async () => {
    listFolderFiles.mockResolvedValueOnce({ ok: true, value: { files: ["a.md", "bad\nname.md", "odd\rname.md"], more: false } });
    const wrapper = pick("/work/docs");
    await wrapper.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="blueprint-pick-file"]').map((file) => file.text())).toEqual(["a.md"]);
  });

  it("says so when the folder has no files, and when it has more than it lists", async () => {
    listFolderFiles.mockResolvedValueOnce({ ok: true, value: { files: [], more: false } });
    const empty = pick("/work/new");
    await empty.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    expect(empty.find('[data-testid="blueprint-pick-none"]').exists()).toBe(true);
    listFolderFiles.mockResolvedValueOnce({ ok: true, value: { files: ["a.md"], more: true } });
    const many = pick("/work/big");
    await many.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    expect(many.text()).toContain(en.blueprints.form.pickMore);
  });

  it("hides a list read for another folder once the folder is changed", async () => {
    const wrapper = pick("/work/docs");
    await wrapper.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    await wrapper.setProps({ projectDir: "/work/other" });
    expect(wrapper.find('[data-testid="blueprint-pick-file"]').exists()).toBe(false);
  });

  it("shows why the listing was refused", async () => {
    listFolderFiles.mockResolvedValueOnce({ ok: false, error: "English", refusal: { code: "not-absolute" } });
    const wrapper = pick("relative");
    await wrapper.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(en.blueprints.refusals.notAbsolute);
  });
});

// The form is kept while the Blueprints screen is closed: an open list is read again when it is shown.
describe("the file list shown again", () => {
  it("is read again, and kept through a failed read", async () => {
    listFolderFiles.mockReset();
    listFolderFiles
      .mockResolvedValueOnce({ ok: true, value: { files: ["contract.txt"], more: false } })
      .mockResolvedValueOnce({ ok: true, value: { files: ["contract.txt", "added.md"], more: false } })
      .mockResolvedValue({ ok: false, error: "gone" });
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintFilePicker, { projectDir: "/work/docs", answer: "" });
    await wrapper.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    const names = () => wrapper.findAll('[data-testid="blueprint-pick-file"]').map((file) => file.text());
    await showAgain();
    expect(names()).toEqual(["contract.txt", "added.md"]);
    await showAgain();
    expect(names()).toEqual(["contract.txt", "added.md"]);
    wrapper.unmount();
  });
});

describe("a file list that failed, shown again", () => {
  it("drops the old failure once the list can be read", async () => {
    listFolderFiles.mockReset();
    listFolderFiles
      .mockResolvedValueOnce({ ok: false, error: "the folder could not be read" })
      .mockResolvedValue({ ok: true, value: { files: ["contract.txt"], more: false } });
    const { wrapper, showAgain } = mountUnderOverlay(BlueprintFilePicker, { projectDir: "/work/docs", answer: "" });
    await wrapper.get('[data-testid="blueprint-pick-files"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("the folder could not be read");
    await showAgain();
    expect(wrapper.text()).not.toContain("the folder could not be read");
    expect(wrapper.findAll('[data-testid="blueprint-pick-file"]').map((file) => file.text())).toEqual(["contract.txt"]);
    wrapper.unmount();
  });
});
