// @vitest-environment jsdom
//
// The two pages of `magazine.md`, RUN rather than read.
//
// `skillTemplates.spec.ts` holds the template to the real declaration gate. What it cannot reach is
// whether the pages DO what the template says they do, and every claim this shape makes is
// behavioural:
//
//   THE URL NAME IS THE DOCUMENT ID, so the same one cannot be created twice — and the refusal
//   that comes back names no field, which from the page is indistinguishable from not being on the
//   roster. The desk holds every article, so it must say so BEFORE sending.
//
//   TWO FIELDS ARE THE SERVER'S. `publishedAt` and `byUid` are in `createFields` because the rules
//   demand it, and a submission that CARRIES either is refused with nothing named. The one part of
//   the declaration that reads as though the page should fill them in.
//
//   `viewer.mine` HAS THREE STATES. `null` is "nobody looked", not "you have none"; read as "none"
//   it takes the controls off the reader's own articles, so the page draws every row and says why.
//
//   AN OPEN EDITOR IS NOT REBUILT. State arrives whenever anybody publishes, which is
//   indistinguishable from the middle of a sentence. Keeping the typed text is not enough:
//   `replaceChildren()` detaches the focused element, so the caret goes with it.
//
//   A CLICK THAT GOES NOWHERE. Nothing can link out of this frame, so `view.open` is the only exit
//   and its promise normally never settles — settling means it did NOT happen.
//
//   A COUNT ON A PUBLIC PAGE IS A PAGE, NOT A TOTAL. The index is handed at most `limit` records
//   and is never told how many exist.
import { describe, it, expect, beforeEach } from "vitest";

// Through Vite rather than `node:fs`: this spec belongs to the DOM-typed project, which carries no
// node globals — the same reason the other template specs read their template this way.
import template from "../../server/skills/mulmoterminal-shared-app/templates/magazine.md?raw";

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

type Row = Record<string, unknown> & { id: string };
type Answer = { ok: boolean; error?: string };

interface Call {
  kind: string;
  cid: string;
  id?: string;
  values?: Record<string, unknown>;
}

interface Loaded {
  tell: (rows: Row[], viewer: Record<string, unknown>) => void;
  calls: Call[];
  answer: (result: Answer) => void;
}

/** The page, with the host it talks to. `correct` is left PENDING on purpose: the saving state is
 *  one of the things under test, and a promise that settles inside the click cannot be observed. */
function load(heading: string, open?: { opened: boolean }): Loaded {
  const html = pageOf(heading);
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, "");
  const [, script] = html.match(/<script>\n([\s\S]*?)\n<\/script>/) ?? [];
  const calls: Call[] = [];
  let onState: ((data: unknown, viewer: unknown) => void) | null = null;
  let answer: (result: Answer) => void = () => {};
  const record =
    (kind: string) =>
    (cid: string, ...rest: unknown[]): Promise<unknown> => {
      const [second, third] = rest;
      calls.push({
        kind,
        cid,
        ...(typeof second === "string" ? { id: second } : {}),
        ...(typeof second === "object" && second !== null ? { values: second as Record<string, unknown> } : {}),
        ...(typeof third === "object" && third !== null ? { values: third as Record<string, unknown> } : {}),
      });
      if (kind === "correct")
        return new Promise((resolve) => {
          answer = resolve as (result: Answer) => void;
        });
      return Promise.resolve({ ok: true });
    };
  Reflect.set(window, "__MC_APP_VIEW", {
    onState: (callback: (data: unknown, viewer: unknown) => void) => {
      onState = callback;
    },
    ready: () => {},
    submit: record("submit"),
    correct: record("correct"),
    withdraw: record("withdraw"),
    open: (cid: string, id: string) => {
      calls.push({ kind: "open", cid, id });
      return Promise.resolve(open ?? { opened: true });
    },
  });
  // eslint-disable-next-line sonarjs/code-eval -- the source is a file in this repository, read at test time
  new Function(script ?? "")();
  expect(onState === null ? "never registered" : "registered").toBe("registered");
  return {
    tell: (rows, viewer) => (onState as unknown as (data: unknown, viewer: unknown) => void)({ articles: rows }, viewer),
    calls,
    answer: (result) => answer(result),
  };
}

const CAN = {
  articles: {
    correctFrom: { published: ["title", "summary", "body", "tags", "byline"] },
    correctAny: false,
    withdrawFrom: ["published"],
    withdrawAny: false,
    frozen: ["slug", "publishedAt", "byUid", "status"],
    maxBytes: { title: 200, summary: 800, body: 60000, byline: 100 },
  },
};

const MINE: Row = {
  id: "why-deploys-slowed",
  title: "Why deploys slowed",
  body: "text",
  status: "published",
  publishedAt: "2026-03-04T09:00:00.000000000Z",
  byline: "ada",
};
const THEIRS: Row = {
  id: "the-other-one",
  title: "The other one",
  body: "text",
  status: "published",
  publishedAt: "2026-03-05T09:00:00.000000000Z",
  byline: "grace",
};

const viewerWhoOwns = { me: "Ada.Lovelace@example.com", can: CAN, mine: { articles: [{ id: MINE.id }] } };
const viewerUnanswered = { me: "ada@example.com", can: CAN };

const buttons = (selector: string): string[] => [...document.querySelectorAll(selector)].map((node) => node.textContent ?? "");
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("magazine.md — the desk", () => {
  it("fills the byline in from the address without locking it, and never publishes the address", () => {
    // The template's own argument: a table of address to display name is a second roster kept by
    // hand, and it can only pretend to give a guarantee `selfUpdate` hands straight back.
    const page = load("views/desk.html");
    page.tell([MINE], viewerWhoOwns);
    const byline = document.querySelectorAll<HTMLInputElement>("#compose input")[3];
    expect(byline?.value).toBe("Ada.Lovelace");
    expect(byline?.disabled).toBe(false);
    expect(document.body.textContent).not.toContain("@example.com");
  });

  it("draws the controls on the reader's own article and on nobody else's", () => {
    const page = load("views/desk.html");
    page.tell([MINE, THEIRS], viewerWhoOwns);
    expect(buttons("#list button")).toEqual(["Rewrite", "Delete"]);
    expect(document.querySelector("#list .note")).toBeNull();
  });

  it("draws them on every row while nobody has looked, and says so", () => {
    // The third state. Read as "you have none", this takes the controls off the reader's OWN work.
    const page = load("views/desk.html");
    page.tell([MINE, THEIRS], viewerUnanswered);
    expect(buttons("#list button")).toEqual(["Rewrite", "Delete", "Rewrite", "Delete"]);
    expect(document.querySelector("#list .note")?.textContent).toContain("has not yet said which of these are yours");
  });

  it("refuses a URL name that is taken before anything is sent", () => {
    const page = load("views/desk.html");
    page.tell([MINE], viewerWhoOwns);
    const inputs = document.querySelectorAll<HTMLInputElement>("#compose input");
    const areas = document.querySelectorAll<HTMLTextAreaElement>("#compose textarea");
    inputs[0].value = "Why deploys slowed, again";
    inputs[1].value = MINE.id;
    areas[1].value = "text";
    document.querySelector<HTMLButtonElement>("#compose .btn")?.click();
    expect(page.calls.filter((call) => call.kind === "submit")).toEqual([]);
    expect(document.querySelector("#compose .msg")?.textContent).toContain(`The URL name ${MINE.id} is already taken`);
  });

  it("sends neither the server's stamp nor the publisher's uid", async () => {
    const page = load("views/desk.html");
    page.tell([], viewerWhoOwns);
    const inputs = document.querySelectorAll<HTMLInputElement>("#compose input");
    const areas = document.querySelectorAll<HTMLTextAreaElement>("#compose textarea");
    inputs[0].value = "A new one";
    areas[1].value = "text";
    document.querySelector<HTMLButtonElement>("#compose .btn")?.click();
    await settle();
    const [sent] = page.calls.filter((call) => call.kind === "submit");
    expect(Object.keys(sent?.values ?? {}).sort()).toEqual(["body", "byline", "slug", "summary", "tags", "title"]);
    expect(sent?.values?.slug).toBe("a-new-one");
  });

  it("offers no field the rules have frozen", () => {
    const page = load("views/desk.html");
    page.tell([MINE], viewerWhoOwns);
    document.querySelectorAll<HTMLButtonElement>("#list .btn.ghost")[0].click();
    const labels = [...document.querySelectorAll(".editor label")].map((node) => node.textContent);
    expect(labels).toEqual(["Headline", "Standfirst", "Tags (comma separated)", "Byline", "Body (Markdown)"]);
    expect(labels).not.toContain("URL name");
  });

  it("keeps the caret in a half-written article when somebody else publishes", () => {
    const page = load("views/desk.html");
    page.tell([MINE], viewerWhoOwns);
    document.querySelectorAll<HTMLButtonElement>("#list .btn.ghost")[0].click();
    const before = document.querySelector<HTMLTextAreaElement>(".editor textarea.body");
    if (before === null) throw new Error("no body field");
    before.value = "half a sentence";
    before.dispatchEvent(new Event("input"));
    before.focus();
    before.setSelectionRange(4, 4);

    page.tell([MINE, THEIRS], viewerWhoOwns);

    const after = document.querySelector<HTMLTextAreaElement>(".editor textarea.body");
    expect(after).toBe(before);
    expect(after?.value).toBe("half a sentence");
    expect(document.activeElement).toBe(after);
    expect(after?.selectionStart).toBe(4);
  });

  it("reports a refused correction in place, sending only what changed", async () => {
    const page = load("views/desk.html");
    page.tell([MINE], viewerWhoOwns);
    document.querySelectorAll<HTMLButtonElement>("#list .btn.ghost")[0].click();
    const body = document.querySelector<HTMLTextAreaElement>(".editor textarea.body");
    if (body === null) throw new Error("no body field");
    body.value = "rewritten";
    body.dispatchEvent(new Event("input"));
    document.querySelector<HTMLButtonElement>(".editor .btn")?.click();

    const [sent] = page.calls.filter((call) => call.kind === "correct");
    expect(sent?.id).toBe(MINE.id);
    expect(sent?.values).toEqual({ body: "rewritten" });
    expect(body.disabled).toBe(true);

    page.answer({ ok: false, error: "PERMISSION_DENIED" });
    await settle();
    expect(document.querySelector(".editor .msg")?.textContent).toContain("PERMISSION_DENIED");
    expect(document.querySelector(".editor textarea.body")).toBe(body);
    expect(body.disabled).toBe(false);
  });
});

describe("magazine.md — the index", () => {
  it("counts what it was handed rather than claiming a total", () => {
    const page = load("views/home.html");
    page.tell([MINE, THEIRS], {});
    expect(document.getElementById("foot")?.textContent).toBe("Latest 2");
  });

  it("says so when a card opens nothing, and stays quiet when it works", async () => {
    const refused = load("views/home.html", { opened: false });
    refused.tell([MINE], {});
    document.querySelector<HTMLButtonElement>(".card")?.click();
    await settle();
    expect(document.querySelector(".card .miss")?.textContent).toContain("would not open");

    const worked = load("views/home.html", { opened: true });
    worked.tell([MINE], {});
    document.querySelector<HTMLButtonElement>(".card")?.click();
    await settle();
    expect(document.querySelector(".card .miss")).toBeNull();
  });
});
