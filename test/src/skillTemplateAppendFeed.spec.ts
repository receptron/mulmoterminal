// @vitest-environment jsdom
//
// The page of `append-feed.md`, RUN rather than read.
//
// `skillTemplates.spec.ts` holds the template to the declaration gate and to the defects a sandbox
// hides. What it cannot reach is what this page is FOR, and the ways this shape goes wrong are all
// invisible in a declaration:
//
//   A CONTROL DRAWN FOR SOMEBODY THE RULES WOULD REFUSE. This template's whole subject is that
//   `writerDelete` is absent — an owner may not delete another member's row. A page that drew the
//   control from the role instead of from `withdrawFrom` would put a delete button in front of
//   every owner and have Firestore refuse each press, which reads as a broken app rather than as
//   the permission it is.
//
//   A THREAD THAT RESHUFFLES ON EVERY POST. `postedAt` is written by the rules, so the sender sees
//   their own row before the stamp exists. Sorted naively the empty key sorts FIRST, the row lands
//   at the top and jumps to the bottom a moment later, and every day divider between them is
//   redrawn. It is the defect the template spends a paragraph on, and copying the page without the
//   `orderKey` fallback reintroduces it silently.
//
//   A PAGE THAT CAPS WHAT IT WAS ALREADY HANDED. The host slices to `views[].limit` and orders by
//   the stamp; a page that slices again is a second, invisible cap that stops tracking the
//   declaration the moment the author changes it.
//
//   A COMPOSER THAT EATS WHAT YOU TYPED. A submission waits on a confirmation and a write, and
//   somebody who keeps typing has written the NEXT message. Clearing the box unconditionally
//   throws it away.
import { describe, it, expect, afterEach } from "vitest";

// Through Vite rather than `node:fs`: this spec belongs to the DOM-typed project, which carries no
// node globals — the same reason `skillTemplateProjectBoard.spec.ts` reads its template this way.
import template from "../../server/skills/mulmoterminal-shared-app/templates/append-feed.md?raw";

/** The html block under the template's page heading — the same mapping the other template specs
 *  read, so a renamed section fails here rather than silently testing nothing. */
function pageOf(heading: string): string {
  const lines = template.split("\n");
  const start = lines.findIndex((line) => /^#{2,3} /.test(line) && line.replace(/^#{2,3} /, "").startsWith(heading));
  expect(`${heading}: ${start === -1 ? "no section" : "has a section"}`).toBe(`${heading}: has a section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,3} /.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n");
  const [, html] = body.match(/```html\n([\s\S]*?)\n```/) ?? [];
  expect(`${heading}: ${html === undefined ? "no html" : "has html"}`).toBe(`${heading}: has html`);
  return html ?? "";
}

/** The page closes its menu from a listener on the DOCUMENT, which jsdom shares between every test
 *  in this file. A listener from the page loaded three tests ago still matches — the selectors are
 *  the template's own — and would answer through the thread IT captured. Recorded as it is
 *  attached, because the handler is anonymous and this is the only moment anything can hold it. */
const attached: { type: string; listener: EventListenerOrEventListenerObject }[] = [];

function runPage(script: string): void {
  for (const { type, listener } of attached.splice(0)) document.removeEventListener(type, listener);
  const add = document.addEventListener.bind(document);
  document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    attached.push({ type, listener });
    add(type, listener, options as boolean);
  };
  try {
    // eslint-disable-next-line sonarjs/code-eval -- the source is a file in this repository, read at test time
    new Function(script)();
  } finally {
    document.addEventListener = add;
  }
}

afterEach(() => {
  for (const { type, listener } of attached.splice(0)) document.removeEventListener(type, listener);
});

interface Row {
  id: string;
  author: string;
  body: string;
  status: string;
  postedAt: string | null;
}

/** A stamp the rules would have written: UTC, nine fractional digits. */
const at = (minute: number): string => `2026-03-04T09:${String(minute).padStart(2, "0")}:00.000000000Z`;

const row = (over: Partial<Row> & { id: string }): Row => ({
  author: "aoi@example.jp",
  body: "本文",
  status: "posted",
  postedAt: at(0),
  ...over,
});

type Sent = { kind: string; cid: string; id?: string; values?: Record<string, string> };

const ME = "aoi@example.jp";

function loadRoom(): {
  sent: Sent[];
  /** What the parent answers the next `submit` with, and when. Left alone every submission
   *  succeeds at once. */
  hold: () => void;
  release: (outcome: { ok: boolean; error?: string }) => void;
  tell: (rows: Row[], withdrawFrom?: string[], me?: string) => void;
  drawn: () => { author: string; body: string; hasMenu: boolean }[];
  nodes: () => Element[];
  banner: () => string;
  hint: () => string;
  compose: (text: string) => void;
  send: () => void;
} {
  const html = pageOf("views/room.html");
  const [, script] = html.match(/<script>\n([\s\S]*?)\n<\/script>/) ?? [];
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, "");

  const sent: Sent[] = [];
  let onState: ((data: unknown, viewer: unknown) => void) | null = null;
  let waiting: ((outcome: { ok: boolean; error?: string }) => void) | null = null;
  let holding = false;

  (window as unknown as { __MC_APP_VIEW: unknown }).__MC_APP_VIEW = {
    onState: (handler: (data: unknown, viewer: unknown) => void) => {
      onState = handler;
    },
    submit: (cid: string, values: Record<string, string>) => {
      sent.push({ kind: "submit", cid, values });
      if (!holding) return Promise.resolve({ ok: true });
      return new Promise<{ ok: boolean; error?: string }>((resolve) => {
        waiting = resolve;
      });
    },
    withdraw: (cid: string, id: string) => {
      sent.push({ kind: "withdraw", cid, id });
      return Promise.resolve({ ok: true });
    },
    ready: () => {},
  };

  // Run rather than insert: jsdom does not execute a <script> element, and markup assigned through
  // `innerHTML` never runs one anywhere — a spec that only rendered the page would assert about
  // controls nothing had wired.
  runPage(script ?? "");

  const body = document.getElementById("body") as HTMLTextAreaElement;
  return {
    sent,
    hold: () => {
      holding = true;
    },
    release: (outcome) => {
      holding = false;
      waiting?.(outcome);
      waiting = null;
    },
    tell: (rows, withdrawFrom = ["posted"], me = ME) => {
      onState?.({ messages: rows }, { me, can: { messages: { cid: "messages", withdrawFrom } } });
    },
    drawn: () =>
      [...document.querySelectorAll(".msg")].map((msg) => ({
        author: msg.querySelector(".avatar")?.getAttribute("style") ?? "",
        body: msg.querySelector(".body")?.textContent ?? "",
        hasMenu: msg.querySelector("[data-menu]") !== null,
      })),
    nodes: () => [...document.querySelectorAll(".thread > .row")],
    banner: () => document.querySelector(".older")?.textContent ?? "",
    hint: () => document.getElementById("hint")?.textContent ?? "",
    compose: (text) => {
      body.value = text;
    },
    send: () => (document.getElementById("post") as HTMLButtonElement).click(),
  };
}

/** The click handler is async — the write is awaited and the parent answers a microtask later. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 32; turn += 1) await Promise.resolve();
};

describe("append-feed.md's room page", () => {
  it("offers the delete control on your own row and on nobody else's", () => {
    const room = loadRoom();
    room.tell([row({ id: "a", author: "ken@example.jp", body: "他人の行" }), row({ id: "b", body: "自分の行" })]);
    // The reader here holds a role — `withdrawFrom` is what the rules answered, and it is answered
    // from the RECORD. Drawing from the role instead would put a control on the first row too, and
    // every press of it would be refused: `writerDelete` is not declared, so no tier deletes
    // somebody else's row.
    expect(room.drawn().map((msg) => `${msg.body}: ${msg.hasMenu}`)).toEqual(["他人の行: false", "自分の行: true"]);
  });

  it("offers it on nothing at all when the rules named no removable status", () => {
    const room = loadRoom();
    // What a host that carries no self-deletion answers, and what `selfDelete` being dropped from
    // the declaration looks like from in here. The page must draw no control rather than draw one
    // that cannot work.
    room.tell([row({ id: "b", body: "自分の行" })], []);
    expect(room.drawn().map((msg) => msg.hasMenu)).toEqual([false]);
  });

  it("puts a row the server has not stamped yet LAST, not first", () => {
    const room = loadRoom();
    // The snapshot the sender's own browser gets: the row exists, `postedAt` does not yet.
    room.tell([row({ id: "old", body: "先にあった行", postedAt: at(1) }), row({ id: "new", body: "いま送った行", postedAt: null })]);
    expect(room.drawn().map((msg) => msg.body)).toEqual(["先にあった行", "いま送った行"]);
  });

  it("keeps the DOM node of a row nothing changed", () => {
    const room = loadRoom();
    room.tell([row({ id: "a", body: "一つ目", postedAt: at(1) })]);
    const first = room.nodes()[0];
    const inside = document.querySelectorAll(".msg")[0];
    room.tell([row({ id: "a", body: "一つ目", postedAt: at(1) }), row({ id: "b", body: "二つ目", postedAt: at(2) })]);
    // Not merely "still two rows": the SAME elements, outer and inner. Keeping the outer one and
    // reassigning its `innerHTML` replaces everything a reader was touching — the text they had
    // selected, the hover under their pointer — so the inner identity is the half that proves the
    // untouched row was not even read.
    expect(room.nodes()[0]).toBe(first);
    expect(document.querySelectorAll(".msg")[0]).toBe(inside);
    expect(room.nodes()).toHaveLength(2);
  });

  it("draws every row it was handed — the cap belongs to the host", () => {
    const room = loadRoom();
    // Exactly `limit.messages`, which is what a host with more to give answers with.
    const rows = Array.from({ length: 200 }, (_, index) => row({ id: `m${index}`, body: `${index}`, postedAt: at(index % 60) }));
    room.tell(rows);
    expect(room.drawn()).toHaveLength(200);
    // And it says there is more WITHOUT a number: the host sliced without counting, so the page
    // does not know how many it is not showing.
    expect(room.banner()).toBe("これより前の記録はここには出ません。");
    expect(room.banner()).not.toMatch(/\d/);
  });

  it("says nothing about older rows when the page was not filled", () => {
    const room = loadRoom();
    room.tell(Array.from({ length: 199 }, (_, index) => row({ id: `m${index}`, body: `${index}`, postedAt: at(index % 60) })));
    expect(room.banner()).toBe("");
  });

  it("keeps what you typed while the last message was still being sent", async () => {
    const room = loadRoom();
    room.tell([]);
    room.hold();
    room.compose("一通目");
    room.send();
    await settle();
    room.compose("一通目\n二通目を書き足した");
    room.release({ ok: true });
    await settle();
    expect((document.getElementById("body") as HTMLTextAreaElement).value).toBe("一通目\n二通目を書き足した");
    expect(room.sent).toEqual([{ kind: "submit", cid: "messages", values: { author: ME, body: "一通目" } }]);
  });

  it("clears the box when nothing was typed over the top of it", async () => {
    const room = loadRoom();
    room.tell([]);
    room.compose("一通目");
    room.send();
    await settle();
    expect((document.getElementById("body") as HTMLTextAreaElement).value).toBe("");
  });

  it("refuses to send an empty message without asking the host", async () => {
    const room = loadRoom();
    room.tell([]);
    room.compose("   ");
    room.send();
    await settle();
    expect(room.sent).toEqual([]);
    expect(room.hint()).toBe("何か書いてください。");
  });
});
