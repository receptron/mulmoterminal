import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, ref, h, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";

import { useGitStatus, type GitStatus } from "../../../src/composables/useGitStatus";

const REPO: GitStatus = { repo: true, branch: "main", detached: false, dirty: 2, ahead: 0, behind: 0, upstream: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function mountGit(initialCwd: string | null) {
  const cwd = ref<string | null>(initialCwd);
  let status!: ReturnType<typeof useGitStatus>["status"];
  const wrapper = mount(
    defineComponent({
      setup() {
        status = useGitStatus(cwd).status;
        return () => h("div");
      },
    }),
  );
  return { wrapper, cwd, get: () => status.value };
}

afterEach(() => vi.unstubAllGlobals());

describe("useGitStatus", () => {
  it("applies the fetched status for the current dir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => REPO })),
    );
    const { get } = mountGit("/repo");
    await flushPromises();
    expect(get()).toEqual(REPO);
  });

  // The #620 shape, on the dir→null edge: a launcher/command cell has no dir, and switching
  // to it while a status fetch for the previous dir is still out must not let that late
  // response repaint the old branch chip. The token has to advance on the null branch too.
  it("drops an in-flight response for a dir the cell has since left", async () => {
    const gate = deferred<boolean>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await gate.promise;
        return { ok: true, json: async () => REPO };
      }),
    );
    const { cwd, get } = mountGit("/repo"); // mount starts the /repo fetch, held on the gate

    cwd.value = null; // switch to a dir-less cell: status clears synchronously
    await nextTick();
    await flushPromises();
    expect(get()).toBeNull();

    gate.resolve(true); // the stale /repo response finally lands
    await flushPromises();
    expect(get()).toBeNull(); // and must be ignored, not revive the old branch
  });
});
