// @vitest-environment jsdom
//
// The live-poll desk, RUN rather than read.
//
// `skillTemplates.spec.ts` holds the templates to the declaration gate and to the defects a sandbox
// hides (a modal, a `<form>`, a missing `ready()`). This one exists because the failure that got
// past all of it was none of those: the desk opened the next question and left the previous one
// open, so the audience — which follows the lowest `order` among the OPEN questions — stayed on the
// question they had already answered. Nothing was refused. The button reported success, the row
// said "open", and the screen everybody was watching did not move.
//
// It cannot be caught by reading a declaration, because the declaration is not what is wrong:
// "at most one question is open" is a statement about the OTHER records, and `transitions` judges
// one record's move. The desk is the only place that can keep it, so the desk is what is run here.
//
// An app was shipped from this template with exactly that defect (`../apps/ai-live-poll`), which is
// what a template costs when it is wrong: it is copied verbatim by an agent that cannot check it.
import { describe, it, expect, beforeEach } from "vitest";

// The template as text, through Vite rather than through `node:fs`: this spec belongs to the
// DOM-typed project (it runs a page), and that program deliberately carries no node globals — see
// the note in `tsconfig.test-server.json` about what mixing the two did to `window.setTimeout`.
import template from "../../server/skills/mulmoterminal-shared-app/templates/live-poll.md?raw";

/** The html block under one of the template's page headings — the same mapping
 *  `skillTemplates.spec.ts` reads, so a renamed section fails here too rather than silently
 *  testing nothing. */
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

interface Question {
  id: string;
  order: number;
  text: string;
  choices: string;
  state: string;
}

type Told = (questions: Question[], votes: Record<string, unknown>[]) => void;
type Refuse = (move: string, error: string) => void;

/** The desk, loaded into a document and holding a fake parent.
 *
 *  The script is run rather than inserted: markup assigned through `innerHTML` never executes its
 *  scripts, and a test that only rendered the HTML would assert about buttons nothing had wired. */
function loadDesk(): { moves: string[]; tell: Told; refuse: Refuse } {
  const html = pageOf("views/desk.html");
  const [, script] = html.match(/<script>\n([\s\S]*?)\n<\/script>/) ?? [];
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, "");

  const moves: string[] = [];
  // Refusals named by the MOVE rather than by call order: what is being pinned is which write the
  // desk sends after a particular one was denied, and a counter would have to be rewritten every
  // time the sequence changes.
  const refusals = new Map<string, string>();
  let onState: ((state: unknown, viewer: unknown) => void) | null = null;
  (window as unknown as { __MC_APP_VIEW: unknown }).__MC_APP_VIEW = {
    onState: (handler: (state: unknown, viewer: unknown) => void) => {
      onState = handler;
    },
    transition: (cid: string, id: string, to: string) => {
      const move = `${cid}/${id} -> ${to}`;
      moves.push(move);
      const error = refusals.get(move);
      return Promise.resolve(error === undefined ? { ok: true } : { ok: false, error });
    },
    ready: () => {},
  };

  // Evaluated, because the page's own loader is not available here: this environment's jsdom does
  // not run <script> elements, and markup assigned through `innerHTML` never runs them anywhere. A
  // spec that only rendered the HTML would assert about buttons nothing had wired.
  // eslint-disable-next-line sonarjs/code-eval -- the source is a file in this repository, read at test time
  new Function(script ?? "")();

  return {
    moves,
    tell: (questions, votes) => {
      // `transitionAny` is what the desk draws its buttons from: the host is a member with the
      // roster's own permission, and a viewer without it gets no buttons at all.
      onState?.({ questions, votes }, { can: { questions: { transitionAny: true } } });
    },
    refuse: (move: string, error: string) => {
      refusals.set(move, error);
    },
  };
}

const question = (id: string, order: number, state: string): Question => ({
  id,
  order,
  text: `Question ${order}`,
  choices: "Yes\nNo",
  state,
});

/** The handler awaits two writes; the clicks below are synchronous. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
};

const buttonFor = (text: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll("button")].find((button) => button.textContent === text);
  expect(`${text}: ${found === undefined ? "not offered" : "offered"}`).toBe(`${text}: offered`);
  return found as HTMLButtonElement;
};

describe("the live-poll desk template", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("closes the question the audience is on before asking the next one", async () => {
    const desk = loadDesk();
    desk.tell([question("q1", 1, "open"), question("q2", 2, "draft")], []);

    buttonFor("Ask this").click();
    await settle();

    // The order is the whole of it. Opening `q2` alone leaves `q1` open, and the audience follows
    // the LOWEST `order` among the open ones — so the screen stays on `q1` while the desk says the
    // move succeeded.
    expect(desk.moves).toEqual(["questions/q1 -> closed", "questions/q2 -> open"]);
  });

  it("goes BACK to an earlier question with the same one press", async () => {
    const desk = loadDesk();
    desk.tell([question("q1", 1, "closed"), question("q2", 2, "open")], []);

    buttonFor("Reopen").click();
    await settle();

    // Reopening `q1` while `q2` is open would move the audience anyway — `q1` has the lower order —
    // and leave `q2` open behind it, so the next press would go nowhere. Going back is a switch.
    expect(desk.moves).toEqual(["questions/q2 -> closed", "questions/q1 -> open"]);
  });

  it("closes the open question on its own, and does not close what is already shut", async () => {
    const desk = loadDesk();
    desk.tell([question("q1", 1, "open"), question("q2", 2, "closed")], []);

    buttonFor("Close").click();
    await settle();
    expect(desk.moves).toEqual(["questions/q1 -> closed"]);

    // Nothing is open now, so asking a question is one move.
    desk.tell([question("q1", 1, "closed"), question("q2", 2, "closed")], []);
    buttonFor("Reopen").click();
    await settle();
    expect(desk.moves).toEqual(["questions/q1 -> closed", "questions/q1 -> open"]);
  });

  it("leaves the audience on the question they were answering when the close is refused", async () => {
    const desk = loadDesk();
    desk.tell([question("q1", 1, "open"), question("q2", 2, "draft")], []);
    desk.refuse("questions/q1 -> closed", "permission-denied");

    buttonFor("Ask this").click();
    await settle();

    // The open is NOT attempted. Sent anyway, both questions would be open and the audience would
    // sit on `q1` — the same silent stall, arrived at from a failure instead of a design.
    expect(desk.moves).toEqual(["questions/q1 -> closed"]);
    expect(document.getElementById("say")?.textContent).toContain("permission-denied");
  });

  it("puts the question back when the OPEN fails after the close landed", async () => {
    const desk = loadDesk();
    desk.tell([question("q1", 1, "open"), question("q2", 2, "draft")], []);
    desk.refuse("questions/q2 -> open", "permission-denied");

    buttonFor("Ask this").click();
    await settle();

    // Left as it was, this is the one state worse than not moving: nothing is open, so every
    // audience page drops to "waiting" while the host is still talking about the question they
    // just closed.
    expect(desk.moves).toEqual(["questions/q1 -> closed", "questions/q2 -> open", "questions/q1 -> open"]);
    expect(document.getElementById("say")?.textContent).toContain("permission-denied");
    expect(document.getElementById("say")?.textContent).toContain("q1 is open again");
  });

  it("says so when the question cannot be put back either", async () => {
    const desk = loadDesk();
    desk.tell([question("q1", 1, "open"), question("q2", 2, "draft")], []);
    desk.refuse("questions/q2 -> open", "permission-denied");
    desk.refuse("questions/q1 -> open", "still-denied");

    buttonFor("Ask this").click();
    await settle();

    // Both refusals are reported. The rows are the truth and the host can press again — hiding the
    // second one would leave them reading "could not open q2" on a screen showing no question.
    expect(desk.moves).toEqual(["questions/q1 -> closed", "questions/q2 -> open", "questions/q1 -> open"]);
    const said = document.getElementById("say")?.textContent ?? "";
    expect(said).toContain("permission-denied");
    expect(said).toContain("still-denied");
  });

  it("gives the buttons back after a refusal, mid-stream", async () => {
    const desk = loadDesk();
    desk.tell([question("q1", 1, "open"), question("q2", 2, "draft")], []);
    desk.refuse("questions/q1 -> closed", "permission-denied");

    buttonFor("Ask this").click();
    await settle();

    // A refused call produces no state update, so nothing redraws this page. Buttons left disabled
    // would stay disabled until the host reloaded — mid-stream, on the page running the show.
    expect([...document.querySelectorAll("button")].every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });
});
