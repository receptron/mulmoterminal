import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CockpitHeader from "../../../src/components/CockpitHeader.vue";
import type { AttentionStatus } from "../../../src/components/attentionStatus";
import type { PrPhase, WorkPhase } from "../../../src/components/rosterPhase";
import type { SessionCollection } from "../../../common/sessionCollection";

type Props = {
  status: AttentionStatus;
  agent: string | null;
  cwd: string | null;
  home: string | null;
  headerColor: string | null;
  headerTextColor: string | null;
  workPhase?: WorkPhase | null;
  phase?: PrPhase;
  dirLength?: number;
  collection?: SessionCollection | null;
};
const base: Props = { status: "idle", agent: "claude", cwd: "/home/me/proj", home: "/home/me", headerColor: null, headerTextColor: null };
const mountH = (over: Partial<Props> = {}, slot?: string) => mount(CockpitHeader, { props: { ...base, ...over }, slots: slot ? { default: slot } : {} });
const bar = (w: ReturnType<typeof mountH>) => w.get('[data-testid="cockpit-header"]');
const badge = (w: ReturnType<typeof mountH>) => w.get('[data-testid="cockpit-badge"]').text();

describe("CockpitHeader", () => {
  it("tints the bar with the configured header colour, and leaves it untinted when there is none", () => {
    expect(bar(mountH({ headerColor: "#123456" })).attributes("style")).toContain("--cell-header-bg: #123456");
    expect(bar(mountH({ headerColor: null })).attributes("style") ?? "").not.toContain("--cell-header-bg");
  });

  it("shows the roster status word for each status", () => {
    expect(badge(mountH({ status: "idle" }))).toBe("idle");
    expect(badge(mountH({ status: "working" }))).toBe("running");
    expect(badge(mountH({ status: "blocked" }))).toBe("waiting");
    expect(badge(mountH({ status: "done" }))).toBe("done");
  });

  it("shows the work phase word while working when it is known", () => {
    expect(badge(mountH({ status: "working", workPhase: "implementing" }))).toBe("editing");
    expect(badge(mountH({ status: "working", workPhase: "planning" }))).toBe("planning");
  });

  // The collection a chat was started from (#2020). Beside the directory icon, not instead of it:
  // these chats run in the workspace, so the directory picture is the same on every one of them.
  it("wears the collection mark only when the session was started from one", () => {
    expect(mountH({ collection: null }).find('[data-testid="cell-collection-mark"]').exists()).toBe(false);
    const marked = mountH({ collection: { slug: "invoices", icon: "receipt_long", title: "Invoices" } });
    const mark = marked.get('[data-testid="cell-collection-mark"]');
    expect(mark.text()).toBe("receipt_long"); // the ligature, which the icon font draws as a glyph
    // The COLLECTION's name, not the ligature's: a reader hearing "receipt_long" learns nothing.
    expect(mark.attributes("title")).toBe("Started from Invoices");
    expect(mark.attributes("role")).toBe("img");
    expect(mark.attributes("aria-label")).toBe("Started from Invoices");
    // The label is on THAT element and on nothing inside it. The glyph within is a Material Symbols
    // LIGATURE, so a second label there makes a screen reader announce "receipt_long" as well as the
    // collection's name — which is why the roster's agent mark is built the same way.
    expect(mark.findAll('[role="img"], [aria-label]')).toHaveLength(0);
    expect(mark.find("span").attributes("aria-hidden")).toBe("true");
  });

  // The other end of round 2's fix. `toSummary` omits the key for a schema naming no icon, and the
  // resolver normalizes that to "" so the record survives the two string guards it used to be
  // dropped by — which is only worth anything if "" then DRAWS. It resolves to the collection
  // default (`dataset`), so the cell still says "this one is about a collection".
  it("still draws a mark for a collection whose schema names no icon", () => {
    const mark = mountH({ collection: { slug: "notes", icon: "", title: "Notes" } }).get('[data-testid="cell-collection-mark"]');
    expect(mark.text()).toBe("dataset");
    expect(mark.attributes("aria-label")).toBe("Started from Notes");
  });

  // And the title falls back to the slug, so the mark is never announced as "Started from ".
  it("names the collection by its slug when the schema has no title", () => {
    const mark = mountH({ collection: { slug: "notes", icon: "task", title: "notes" } }).get('[data-testid="cell-collection-mark"]');
    expect(mark.attributes("aria-label")).toBe("Started from notes");
  });

  it("shows the PR phase pill only when there is a phase", () => {
    expect(mountH({ phase: "none" }).find('[data-testid="cockpit-phase"]').exists()).toBe(false);
    expect(mountH({ phase: "ready" }).find('[data-testid="cockpit-phase"]').exists()).toBe(true);
  });

  it("shows the picker-style agent icon for every built-in agent and shell", () => {
    for (const agent of ["claude", "codex", "antigravity", "grok", "muse", "shell"]) {
      expect(mountH({ agent }).find('[data-testid="cockpit-agent-icon"]').exists()).toBe(true);
    }
  });

  // A cell that has launched nothing has no kind to show, and Claude's burst is the wrong guess:
  // the status dot and the directory already identify the row.
  it("marks nothing when the row runs nothing", () => {
    expect(mountH({ agent: null }).find('[data-testid="cockpit-agent-icon"]').exists()).toBe(false);
  });

  it("names the mark for assistive tech, which cannot read a drawn glyph", () => {
    expect(mountH({ agent: "codex" }).find('[data-testid="cockpit-agent-icon"]').attributes("aria-label")).toBe("codex");
    expect(mountH({ agent: "shell" }).find('[data-testid="cockpit-agent-icon"]').attributes("aria-label")).toBe("shell");
  });

  it("does not print the agent name beside the icon", () => {
    expect(mountH({ agent: "codex" }).text()).not.toContain("codex");
    expect(mountH({ agent: "shell" }).text()).not.toContain("Shell");
  });

  it("renders the directory and the trailing slot", () => {
    const w = mountH({ cwd: "/home/me/proj", home: "/home/me" }, '<button data-testid="slotted">x</button>');
    expect(w.text()).toContain("proj");
    expect(w.find('[data-testid="slotted"]').exists()).toBe(true);
  });

  it("clips the directory from the front, so the tail survives the roster's narrow column", () => {
    const dir = mountH({ cwd: "/home/me/work/nested/deep/proj", home: "/home/me" }).get('[data-testid="cockpit-dir"]');
    expect(dir.classes()).toContain("[direction:rtl]");
    expect(dir.classes()).toContain("truncate");
    // rtl flips the default alignment too, which would push a short path to the trailing edge.
    expect(dir.classes()).toContain("text-left");
    // rtl reorders punctuation unless the path text opts back into logical order.
    expect(dir.get("span").classes()).toContain("[unicode-bidi:plaintext]");
    // The full path moved from a `title` to the shared hover tip (#1235) — asserted end to end in
    // hoverTip.spec.ts. The attribute has to be gone, or the browser's own slow tooltip appears a
    // second time on top of it.
    expect(dir.attributes("title")).toBeUndefined();
  });
});
