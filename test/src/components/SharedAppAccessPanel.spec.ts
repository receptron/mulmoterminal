import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import type { SharedAppAccess } from "../../../common/sharedAppAccess";

const Panel = (await import("../../../src/components/SharedAppAccessPanel.vue")).default;

const shut = { read: "none", create: false, editOwn: false, editAll: false } as const;

function answer(access: SharedAppAccess) {
  globalThis.fetch = vi.fn(
    async () => ({ ok: true, status: 200, json: async () => ({ declared: true, ok: true, access }) }) as unknown as Response,
  ) as unknown as typeof fetch;
}

const CLOSED: SharedAppAccess = {
  publicFace: "declared",
  collections: [
    {
      cid: "records",
      takesSubmissions: true,
      authStage: "verifiedEmail",
      census: { writers: 1, readers: 0, participants: 4 },
      caveats: [],
      access: {
        visitor: shut,
        stranger: shut,
        participant: { read: "all", create: true, editOwn: true, editAll: false },
        writer: { read: "all", create: true, editOwn: true, editAll: true },
      },
    },
  ],
};

describe("the access panel", () => {
  it("leads with the switch, because every cell under it is downstream of that one field", async () => {
    answer(CLOSED);
    const w = mount(Panel, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.find('[data-testid="access-face-declared"]').text()).toContain("This app is CLOSED");
    expect(w.text()).toContain("1 of 1 collections are shut to everyone outside the roster.");
  });

  it("colours an outsider's cell only where the outsider reaches something", async () => {
    answer(CLOSED);
    const w = mount(Panel, { props: { cwd: "/srv/app" } });
    await flushPromises();
    const stranger = w.find('[data-testid="access-records-stranger"]');
    expect(stranger.text()).toContain("Nothing");
    expect(stranger.html()).not.toContain("text-amber");

    // The same table with the app opened: now the stranger reads every row, and that is the line
    // the author opened this panel to find.
    answer({
      ...CLOSED,
      publicFace: "open",
      collections: [
        { ...CLOSED.collections[0], access: { ...CLOSED.collections[0].access, stranger: { read: "all", create: true, editOwn: false, editAll: false } } },
      ],
    });
    const open = mount(Panel, { props: { cwd: "/srv/app" } });
    await flushPromises();
    const row = open.find('[data-testid="access-records-stranger"]');
    expect(row.text()).toContain("All rows");
    expect(row.text()).toContain("Submit only");
    expect(row.html()).toContain("text-amber");
  });

  it("does not colour a participant who reaches the same thing", async () => {
    // A participant reading their own rows is the app working. A table where every filled cell is
    // highlighted highlights nothing.
    answer(CLOSED);
    const w = mount(Panel, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.find('[data-testid="access-records-participant"]').html()).not.toContain("text-amber");
  });

  it("counts the roster into the rows that describe it, and nowhere else", async () => {
    answer(CLOSED);
    const w = mount(Panel, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.find('[data-testid="access-records-participant"]').text()).toContain("(4)");
    // "Signed in, not invited (0)" would read as "nobody can do this", which is the opposite of
    // what that row is for.
    expect(w.find('[data-testid="access-records-stranger"]').text()).not.toContain("(");
  });

  it("reports a manifest it could not read instead of an empty table", async () => {
    globalThis.fetch = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => ({ declared: true, ok: false, problems: ["app.json is not JSON"] }) }) as unknown as Response,
    ) as unknown as typeof fetch;
    const w = mount(Panel, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.text()).toContain("app.json is not JSON");
    expect(w.text()).not.toContain("collections are shut");
  });

  it("says so when the summary could not be computed at all", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const w = mount(Panel, { props: { cwd: "/srv/app" } });
    await flushPromises();
    expect(w.text()).toContain("Could not work out the access summary.");
  });
});
