import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RoundTableMenu from "../../../src/components/RoundTableMenu.vue";
import { DEFAULT_TURN_BUDGET, MAX_MEMBERS } from "../../../src/composables/roundTableRules";
import { isRoomId } from "../../../common/roomMessage";
import type { HandoffTarget } from "../../../src/composables/useHandoff";

// The picker asks the server which rooms already exist, to offer them for reuse.
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ rooms: ["standup", "design-review"] }) })) as unknown as typeof fetch;
});

const target = (n: number): HandoffTarget => ({ key: `cell-${n}`, label: `#${n}`, source: { sessionId: `S${n}`, cwd: "/w", agent: "claude" } });
const render = (targets: HandoffTarget[], running = false, busy = running) =>
  mount(RoundTableMenu, { props: { targets, selfLabel: "#1", running, busy, room: null } });

const seats = (w: ReturnType<typeof render>) => w.findAll('[data-testid="round-table-seat"]');

describe("RoundTableMenu", () => {
  // #2003: one seat per other terminal, so on a 20-cell grid this block was 938px of a menu that
  // had no bound and nothing scrollable — Start ended up a thousand pixels below the window.
  // jsdom has no layout, so what a spec CAN hold is the structure the CSS needs: the seats sit in
  // their own scroll box, and the controls that act on them sit OUTSIDE it.
  describe("staying reachable on a big grid (#2003)", () => {
    const many = Array.from({ length: 19 }, (_, i) => target(i + 2));

    it("puts every seat inside the scrollable box", () => {
      const w = render(many);
      const box = w.find('[data-testid="round-table-seats"]');
      expect(box.exists()).toBe(true);
      expect(box.findAll('[data-testid="round-table-seat"]')).toHaveLength(19);
    });

    // Stated as what is PERMITTED rather than as a list of controls to check, because a list of
    // controls is a list someone adds to. Codex round 3 found exactly that: `flex-none` was the
    // documented invariant, and Start and the room-error row had been missed while stop and watch
    // had it — one fix applied at some of its sites. Every direct child of the bounded column is
    // now either THE scroll box or non-shrinking; anything else fails here the moment it is added.
    it("lets only the seat box shrink — every other direct child is flex-none", () => {
      const column = render(many).find('[data-testid="round-table"]');
      const offenders = Array.from(column.element.children)
        .filter((el) => el.getAttribute("data-testid") !== "round-table-seats")
        .filter((el) => !el.classList.contains("flex-none"))
        .map((el) => el.getAttribute("data-testid") ?? el.tagName.toLowerCase());
      expect(offenders).toEqual([]);
    });

    it("keeps Start, turns and room OUT of that box, so they cannot scroll away", () => {
      const w = render(many);
      const box = w.find('[data-testid="round-table-seats"]');
      ["round-table-start", "round-table-budget", "round-table-room"].forEach((id) => {
        const el = w.find(`[data-testid="${id}"]`);
        expect(el.exists()).toBe(true);
        expect(box.element.contains(el.element)).toBe(false);
      });
    });

    // The box has to give way inside a bounded menu, but not all the way: measured at
    // max-height 120-260px, `min-h-0` let it collapse to 0px, and a seat list with no height is a
    // list nobody can tick — which leaves Start disabled however reachable it is (Codex round 1).
    // So it scrolls, and it keeps a floor of about one row.
    it("scrolls, but keeps a floor so the seats stay clickable", () => {
      const cls = render(many).find('[data-testid="round-table-seats"]').classes();
      expect(cls).toContain("overflow-y-auto");
      expect(cls).toContain("min-h-[2.5rem]");
      expect(cls).not.toContain("min-h-0");
    });
  });

  // This picker IS the admission control: agents cannot see each other or join anything, so a
  // table exists only because a human ticked these boxes.
  it("offers a seat for every readable terminal", () => {
    expect(seats(render([target(2), target(3)]))).toHaveLength(2);
  });

  it("cannot start until at least one other terminal is picked", async () => {
    const w = render([target(2), target(3)]);
    const start = w.find('[data-testid="round-table-start"]');
    expect(start.attributes("disabled")).toBeDefined(); // one cell talking to itself answers nothing
    await seats(w)[0]?.setValue(true);
    expect(w.find('[data-testid="round-table-start"]').attributes("disabled")).toBeUndefined();
  });

  it("starts a table with the picked terminals and the chosen budget", async () => {
    const w = render([target(2), target(3)]);
    await seats(w)[1]?.setValue(true);
    await w.find('[data-testid="round-table-start"]').trigger("click");
    const started = w.emitted("start");
    expect(started).toHaveLength(1);
    expect((started?.[0]?.[0] as HandoffTarget[]).map((t) => t.key)).toEqual(["cell-3"]);
    expect(started?.[0]?.[1]).toBe(DEFAULT_TURN_BUDGET);
  });

  // The cap counts the starting cell, which always has a seat — so the user may tick one fewer
  // than the table holds, and the boxes past it refuse rather than being silently dropped later.
  it("stops ticking once the table is full, counting the cell that starts it", async () => {
    const many = Array.from({ length: MAX_MEMBERS + 2 }, (_, i) => target(i + 2));
    const w = render(many);
    // Only the boxes a user could actually click — the rest are disabled, which is the refusal.
    for (const box of seats(w)) {
      if (box.attributes("disabled") === undefined) await box.setValue(true);
    }
    expect(seats(w).filter((box) => box.attributes("disabled") !== undefined)).toHaveLength(3);

    // The contract, rather than the DOM's idea of checked: what the table is actually started with.
    await w.find('[data-testid="round-table-start"]').trigger("click");
    const chosen = w.emitted("start")?.[0]?.[0] as HandoffTarget[];
    expect(chosen).toHaveLength(MAX_MEMBERS - 1); // the starting cell holds the last seat
  });

  it("offers stop instead of start while a table is running", () => {
    const w = render([target(2)], true);
    expect(w.find('[data-testid="round-table-start"]').exists()).toBe(false);
    expect(w.find('[data-testid="round-table-stop"]').exists()).toBe(true);
  });

  it("emits stop when the running table is stopped", async () => {
    const w = render([target(2)], true);
    await w.find('[data-testid="round-table-stop"]').trigger("click");
    expect(w.emitted("stop")).toHaveLength(1);
  });

  it("does not let seats change while a table is running", () => {
    const w = render([target(2), target(3)], true);
    expect(seats(w).every((box) => box.attributes("disabled") !== undefined)).toBe(true);
  });

  // Only one automation may type into terminals at a time: both loops submit with pasteAndSubmit
  // and both correlate on the tail of what they sent, so two running together interleave their
  // writes and each can take the other's turn as its own answer. The one-turn exchange beside this
  // picker is the other one. (Codex review on #1456.)
  it("refuses to start while the cell's OTHER automation is running", () => {
    const w = render([target(2)], false, true); // an exchange is running, no table
    expect(w.find('[data-testid="round-table-start"]').exists()).toBe(true); // still a Start…
    expect(w.find('[data-testid="round-table-start"]').attributes("disabled")).toBeDefined(); // …that refuses
    expect(seats(w).every((box) => box.attributes("disabled") !== undefined)).toBe(true);
  });

  // Stopping is the other control's job — this button must not offer to stop something it does
  // not own, or the user presses it and the exchange carries on.
  it("keeps offering Start, not Stop, when the busy automation is not this table", () => {
    expect(
      render([target(2)], false, true)
        .find('[data-testid="round-table-stop"]')
        .exists(),
    ).toBe(false);
  });

  // The room box is where "reuse" and "naming" are the same control: whatever you type is the
  // room, existing or not, and typing nothing keeps the old behaviour of minting a fresh one.
  describe("which room the table talks in", () => {
    const startWithRoom = async (typed: string) => {
      const w = render([target(2)]);
      await flushPromises();
      if (typed) await w.find('[data-testid="round-table-room"]').setValue(typed);
      await w.find('[data-testid="round-table-seat"]').setValue(true);
      await w.find('[data-testid="round-table-start"]').trigger("click");
      return { w, room: w.emitted("start")?.[0]?.[2] };
    };

    it("mints a new room when nothing is typed", async () => {
      const { room } = await startWithRoom("");
      expect(typeof room).toBe("string");
      expect(isRoomId(String(room))).toBe(true);
    });

    it("uses the name that was typed, so an existing conversation continues", async () => {
      expect((await startWithRoom("standup")).room).toBe("standup");
    });

    it("offers the rooms that already exist", async () => {
      const w = render([target(2)]);
      await flushPromises();
      expect(w.findAll("#round-table-rooms option").map((o) => o.attributes("value"))).toEqual(["standup", "design-review"]);
    });

    // Falling back to a new room here would run the table somewhere the user never named, and they
    // would look for the conversation under the name they typed.
    it("refuses a name that cannot be a room id rather than quietly minting one", async () => {
      const { w, room } = await startWithRoom("Design Review!");
      expect(room).toBeUndefined();
      expect(w.emitted("start")).toBeUndefined();
      expect(w.find('[data-testid="round-table-room-error"]').exists()).toBe(true);
    });
  });

  // Until this button existed, the conversation a table produced was reachable only by knowing the
  // room id and running the CLI.
  it("offers to open the room, both while the table runs and after it ends", () => {
    const withRoom = (running: boolean) => mount(RoundTableMenu, { props: { targets: [target(2)], selfLabel: "#1", running, busy: running, room: "standup" } });
    expect(withRoom(true).find('[data-testid="round-table-watch"]').exists()).toBe(true);
    expect(withRoom(false).find('[data-testid="round-table-watch"]').exists()).toBe(true);
    expect(
      render([target(2)])
        .find('[data-testid="round-table-watch"]')
        .exists(),
    ).toBe(false);
  });
});
