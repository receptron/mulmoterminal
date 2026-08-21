// @vitest-environment jsdom
//
// Both pages of `project-board.md`, RUN rather than read.
//
// `skillTemplates.spec.ts` holds the template to the declaration gate and to the defects a sandbox
// hides; `skillTemplateSubmitCancel.spec.ts` presses やめる on its public page. Neither executes
// what this template is FOR, and the failures it can have are ones a declaration cannot show:
//
//   A CONTROL THAT IS NOT THERE. `withdrawAny` is `false` for a whole tier until the app is
//   republished, and a desk that reads the capability wrongly is a page with no buttons — which
//   looks exactly like a page whose author got the names wrong.
//
//   A CONTROL THAT CANNOT WORK. `/m/` admits every member, including a `viewer` and somebody
//   scoped to another collection. A form drawn for them is refused on every press, by rules that
//   name nothing.
//
//   AN ANSWER MISTAKEN FOR ANOTHER. `view.mine()` has three states, and the board's whole job is
//   to tell them apart: an empty list is "you have not registered", a missing key is "nobody
//   looked". Conflating them draws the registration form on top of a registration that exists —
//   the bug this template was extracted from.
//
//   AN UNKNOWN TREATED AS A YES. The other half of the same three states, and the one that cost
//   two published apps: "nobody looked" was let through to the take, the rules do not consult the
//   roster, so the write SUCCEEDED and produced a claim with a uid and no name. Nothing failed
//   anywhere — the board drew it under `holderName`'s fallback, beside the real ones.
import { describe, it, expect, beforeEach } from "vitest";

// Through Vite rather than `node:fs`: this spec belongs to the DOM-typed project, which carries no
// node globals — the same reason `skillTemplateLivePollDesk.spec.ts` reads its template this way.
import template from "../../server/skills/mulmoterminal-shared-app/templates/project-board.md?raw";

/** The html block under one of the template's page headings — the same mapping the other template
 *  specs read, so a renamed section fails here rather than silently testing nothing. */
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

/** Run one page's script, remembering what it attached to the DOCUMENT.
 *
 *  BOTH PAGES DELEGATE: a single `click` listener on `document` reads `data-act`, which is what
 *  lets them rebuild their rows freely. jsdom hands every test in this file the same document, so
 *  a listener from a page loaded three tests ago is still on it — and it still matches, because
 *  the labels are the template's own. It would then answer a click through the parent IT captured,
 *  which is a different recorder from the one the test is reading.
 *
 *  Nothing has gone wrong yet, and that is the point: it would go wrong as a cross-test effect
 *  nobody could place, in the file whose whole subject is which control does what.
 *
 *  Recorded rather than reconstructed — the page's handler is anonymous and this is the only
 *  moment anything can hold a reference to it. */
const attached: { type: string; listener: EventListenerOrEventListenerObject }[] = [];

/** Every page loaded in this test, off the document again. */
function detachPages(): void {
  for (const { type, listener } of attached.splice(0)) {
    document.removeEventListener(type, listener);
  }
}

function runPage(script: string): void {
  // The page already on this document is GONE — its markup was replaced a line ago in the caller —
  // so its handler goes with it rather than at the end of the test. That also makes the two loads
  // inside one test behave the way a browser would.
  detachPages();
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

interface Capability {
  cid: string;
  transitionAny: boolean;
  transitionOwn: boolean;
  assign: boolean;
  assignees: string[];
  withdrawFrom: string[];
  withdrawAny: boolean;
}

/** What the projection resolves for a reader who may do everything on this collection, and for one
 *  who holds a role and may write nothing — the `viewer` the member tier also admits. */
const may = (cid: string, over: Partial<Capability> = {}): Capability => ({
  cid,
  transitionAny: true,
  transitionOwn: false,
  assign: false,
  assignees: [],
  withdrawFrom: [],
  withdrawAny: true,
  ...over,
});

const mayNot = (cid: string): Capability => may(cid, { transitionAny: false, withdrawAny: false });

type Sent = { kind: string; cid: string; id?: string; to?: string; values?: Record<string, string> };

/** The desk in a document, with a parent that records what it was asked to write. */
function loadDesk(): {
  sent: Sent[];
  tell: (data: Record<string, unknown[]>, can: Record<string, Capability>) => void;
  said: () => string;
  buttons: () => string[];
  press: (label: string) => void;
} {
  const html = pageOf("views/desk.html");
  const [, script] = html.match(/<script>\n([\s\S]*?)\n<\/script>/) ?? [];
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, "");

  const sent: Sent[] = [];
  let onState: ((data: unknown, viewer: unknown) => void) | null = null;
  (window as unknown as { __MC_APP_VIEW: unknown }).__MC_APP_VIEW = {
    onState: (handler: (data: unknown, viewer: unknown) => void) => {
      onState = handler;
    },
    submit: (cid: string, values: Record<string, string>) => {
      sent.push({ kind: "submit", cid, values });
      return Promise.resolve({ ok: true });
    },
    transition: (cid: string, id: string, to: string) => {
      sent.push({ kind: "transition", cid, id, to });
      return Promise.resolve({ ok: true });
    },
    withdraw: (cid: string, id: string) => {
      sent.push({ kind: "withdraw", cid, id });
      return Promise.resolve({ ok: true });
    },
    ready: () => {},
  };

  // Run rather than insert: jsdom does not execute <script> elements, and markup assigned through
  // `innerHTML` never runs them anywhere — a spec that only rendered the page would assert about
  // buttons nothing had wired.
  runPage(script ?? "");

  const all = (): HTMLButtonElement[] => [...document.querySelectorAll("button")] as HTMLButtonElement[];
  return {
    sent,
    tell: (data, can) => onState?.(data, { me: "owner@example.com", can }),
    said: () => document.getElementById("say")?.textContent ?? "",
    buttons: () => all().map((button) => button.textContent ?? ""),
    press: (label) => {
      const button = all().find((candidate) => candidate.textContent === label);
      expect(`${label}: ${button === undefined ? "missing" : "present"}`).toBe(`${label}: present`);
      button?.click();
    },
  };
}

/** The click handler is async — the write is awaited and the parent answers a microtask later. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 32; turn += 1) {
    await Promise.resolve();
  }
};

/** The public board, with a parent that records the submissions it is asked to make.
 *
 *  A separate loader from the desk's because what has to be controllable is different: this page's
 *  subject is the VIEWER — what `mine` says, and whether the page believes it — where the desk's is
 *  `can`. */
function loadBoard(): {
  sent: Sent[];
  /** What the parent answers the NEXT submission with. The board's guard turns on whether the
   *  registration actually LANDED, so a stub that only ever succeeds cannot reach the branch that
   *  matters — a refused `names` write must not be followed by a claim. */
  answer: (outcome: { ok: boolean; error?: string }) => void;
  /** What the host answers `view.mine(cid, key)` with. The board asks this from `onState` when
   *  `viewer.mine` said nothing — it is how a reader who registered on an earlier visit is
   *  recognised on a host that carries no `mine`, and both writing hosts wire the port. */
  lookup: (answer: { known: boolean; found?: boolean; record?: Record<string, unknown> }) => void;
  /** Make every `view.mine` hang, so writes can land while one is still out — the race that turns a
   *  stale answer into a lockout. They QUEUE: `release` answers the oldest one still waiting, which
   *  is what lets a test deliver an overtaken reply after a newer request went out. */
  hold: () => void;
  release: (answer: { known: boolean; found?: boolean; record?: Record<string, unknown> }) => void;
  /** How many lookups are waiting — so a test can assert that a retry actually went out. */
  waiting: () => number;
  tell: (data: Record<string, unknown[]>, mine?: Record<string, unknown[]>) => void;
  said: () => string;
  buttons: () => string[];
  press: (label: string) => void;
} {
  const html = pageOf("views/board.html");
  const [, script] = html.match(/<script>\n([\s\S]*?)\n<\/script>/) ?? [];
  document.body.innerHTML = html.replace(/<script>[\s\S]*?<\/script>/, "");

  const sent: Sent[] = [];
  let outcome: { ok: boolean; error?: string } = { ok: true };
  // `known: false` by default — "nobody looked", which is what a host with no port answers.
  type Look = { known: boolean; found?: boolean; record?: Record<string, unknown> };
  let looked: Look = { known: false };
  let holding = false;
  const held: ((answer: Look) => void)[] = [];
  let onState: ((data: unknown, viewer: unknown) => void) | null = null;
  (window as unknown as { __MC_APP_VIEW: unknown }).__MC_APP_VIEW = {
    onState: (handler: (data: unknown, viewer: unknown) => void) => {
      onState = handler;
    },
    submit: (cid: string, values: Record<string, string>) => {
      sent.push({ kind: "submit", cid, values });
      return Promise.resolve(outcome);
    },
    transition: (cid: string, id: string, to: string) => {
      sent.push({ kind: "transition", cid, id, to });
      return Promise.resolve({ ok: true });
    },
    withdraw: (cid: string, id: string) => {
      sent.push({ kind: "withdraw", cid, id });
      return Promise.resolve({ ok: true });
    },
    mine: () =>
      holding
        ? new Promise<Look>((resolve) => {
            held.push(resolve);
          })
        : Promise.resolve(looked),
    ready: () => {},
  };

  runPage(script ?? "");

  const all = (): HTMLButtonElement[] => [...document.querySelectorAll("button")] as HTMLButtonElement[];
  return {
    sent,
    answer: (next) => {
      outcome = next;
    },
    lookup: (next) => {
      looked = next;
    },
    hold: () => {
      holding = true;
    },
    release: (answer) => {
      held.shift()?.(answer);
    },
    waiting: () => held.length,
    // `mine` OMITTED rather than passed empty when the caller says nothing: that distinction is the
    // subject of half the cases below, and a harness that invented `{}` would erase it.
    tell: (data, mine) => onState?.(data, { me: null, can: {}, ...(mine === undefined ? {} : { mine }) }),
    said: () => document.getElementById("say")?.textContent ?? "",
    buttons: () => all().map((button) => button.textContent ?? ""),
    press: (label) => {
      const button = all().find((candidate) => candidate.textContent === label);
      expect(`${label}: ${button === undefined ? "missing" : "present"}`).toBe(`${label}: present`);
      button?.click();
    },
  };
}

const TASKS = [{ id: "fix-login", title: "ログインを直す" }];
const DOING = [{ id: "fix-login", uid: "uid-1", status: "doing" }];
const OWNER_CAN = { tasks: may("tasks", { transitionAny: false }), assignments: may("assignments") };

describe("the project-board owner's desk", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    detachPages();
  });

  it("adds a task through the owner-only form", async () => {
    // The form exists because `public.submit.tasks` is declared; it is usable because the rules
    // reach the writer branch independently of the closed window. What is pinned here is that the
    // page sends the create at all, and sends the fields the declaration names.
    const desk = loadDesk();
    desk.tell({ tasks: [], assignments: [], names: [] }, OWNER_CAN);
    (document.getElementById("t-title") as HTMLInputElement).value = "新しい作業";
    desk.press("この作業を足す");
    await settle();

    expect(desk.sent).toEqual([{ kind: "submit", cid: "tasks", values: { title: "新しい作業", detail: "", due: "" } }]);
    expect(desk.said()).not.toBe("");
  });

  it("hides every control from a member who holds no role here", () => {
    // `/m/` admits anybody on the roster — a `viewer`, or somebody scoped to another collection —
    // and they read the same page as the owner. Drawing the form for them is drawing a button that
    // is refused on every press, by rules that name nothing.
    const desk = loadDesk();
    desk.tell({ tasks: TASKS, assignments: DOING, names: [] }, { tasks: mayNot("tasks"), assignments: mayNot("assignments") });

    expect(desk.buttons()).toEqual([]);
    expect(document.getElementById("t-title")).toBeNull();
    expect(document.getElementById("add")?.textContent ?? "").toContain("owner / editor");
  });

  it("keeps what the owner has typed when somebody else's write arrives", async () => {
    // The state message lands whenever anybody moves a row. Rebuilding the inputs on each one
    // empties the field somebody is halfway through — which reads as the page throwing their work
    // away, and is the reason the form is built once rather than on every render.
    const desk = loadDesk();
    desk.tell({ tasks: TASKS, assignments: [], names: [] }, OWNER_CAN);
    (document.getElementById("t-title") as HTMLInputElement).value = "打ちかけ";
    desk.tell({ tasks: TASKS, assignments: DOING, names: [] }, OWNER_CAN);

    expect((document.getElementById("t-title") as HTMLInputElement).value).toBe("打ちかけ");
  });

  it("frees somebody else's assignment, and asks first", async () => {
    // The destructive one, and the whole reason `writerDelete` exists. It is asked in the PAGE
    // because the sandbox ignores `confirm()` — a guard written with it would answer false and the
    // button would silently do nothing.
    const desk = loadDesk();
    desk.tell({ tasks: TASKS, assignments: DOING, names: [{ id: "uid-1", name: "山田" }] }, OWNER_CAN);

    desk.press("担当を外す");
    expect(desk.sent).toEqual([]);
    desk.press("はい");
    await settle();

    expect(desk.sent).toEqual([{ kind: "withdraw", cid: "assignments", id: "fix-login" }]);
  });

  it("will not delete a task while somebody is on it, and says why", async () => {
    // The rules cannot express this: deleting the task leaves the assignment holding an id whose
    // task is gone, and nothing refuses it. So the page is where it is stopped — and it says what
    // to do rather than merely refusing.
    const desk = loadDesk();
    desk.tell({ tasks: TASKS, assignments: DOING, names: [] }, OWNER_CAN);

    desk.press("この作業を消す");
    expect(document.body.textContent ?? "").toContain("先に担当を外してください");
    expect(desk.buttons()).not.toContain("はい");

    desk.press("わかった");
    expect(desk.sent).toEqual([]);
  });

  it("deletes a task nobody is on, after the second press", async () => {
    // The paired acceptance: the guard above must stop one case and not the feature.
    const desk = loadDesk();
    desk.tell({ tasks: TASKS, assignments: [], names: [] }, OWNER_CAN);

    desk.press("この作業を消す");
    desk.press("はい");
    await settle();

    expect(desk.sent).toEqual([{ kind: "withdraw", cid: "tasks", id: "fix-login" }]);
  });

  it("offers the status move only where the projection carries it", async () => {
    // `transitionAny` is the staff table (`collections.assignments.transitions`), which is a
    // different declaration from the submitter's `selfTransitions`. A desk that drew this from the
    // audience rather than the capability would offer it on an app that never declared one.
    const desk = loadDesk();
    desk.tell({ tasks: TASKS, assignments: DOING, names: [] }, { ...OWNER_CAN, assignments: may("assignments", { transitionAny: false }) });
    expect(desk.buttons()).not.toContain("完了にする");

    desk.tell({ tasks: TASKS, assignments: DOING, names: [] }, OWNER_CAN);
    desk.press("完了にする");
    await settle();
    expect(desk.sent).toEqual([{ kind: "transition", cid: "assignments", id: "fix-login", to: "done" }]);
  });
});

describe("the project-board public board", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    detachPages();
  });

  it("REGISTERS on the press when nobody looked, and does NOT take the work in the same one", async () => {
    // No `mine` key at all — a refused read, an offline blink, a host that answers nothing (every
    // host, before mulmoserver wired `mine` into the public page on 2026-08-19). The page must not
    // take the action away from somebody who may well be registered, and it must not let the press
    // through either: the rules do not consult the roster, so the write would SUCCEED and leave a
    // row carrying a uid and no name — drawn on the board under `holderName`'s fallback, with
    // nothing anywhere reporting a fault. Two published apps reached that state.
    //
    // ONE WRITE PER PRESS, which is why the take does not follow the registration here. A `submit`
    // issued after awaiting an earlier one resumes in a later task, so the runtime does not mark it
    // as caused by the click — and a host that gates writes on that mark (`manageSharedApp`'s
    // `preview`) withholds it. Chaining them would register the name and silently drop the claim.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] });

    expect(board.buttons()).toContain("これをやります");
    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([{ kind: "submit", cid: "names", values: { name: "山田" } }]);
    expect(board.said()).toContain("もう一度");
  });

  it("takes the work on the SECOND press, once the registration landed", async () => {
    // The other half of the same press-per-write rule, and the reason the page remembers within the
    // visit: `mine` never arrived and never will on this host, so nothing else can say the name is
    // there now. The write contract is what the declaration is built around — the page sends the
    // task id and NOTHING else. `uid` comes from the session and `status` from `initialStatus`,
    // both filled by the host.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    (document.getElementById("who") as HTMLInputElement).value = "山田";

    board.press("これをやります");
    await settle();
    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([
      { kind: "submit", cid: "names", values: { name: "山田" } },
      { kind: "submit", cid: "assignments", values: { taskId: "fix-login" } },
    ]);
  });

  it("recognises a reader who registered on an EARLIER VISIT, with no `mine` at all", async () => {
    // The reload, which is the case a page cannot hold in a variable: `mine` is absent, nothing was
    // registered in this visit, and the reader has a row sitting in Firestore. Asked from `onState`
    // rather than from the click, so the answer is already in when they press — a lookup awaited
    // inside the handler would cost the press its gesture mark and the take with it.
    //
    // The key is a placeholder on purpose. Under `idFrom: "auth.uid"` the id IS the uid and
    // `recordId` never reads the record, so nothing about this collection has a key to name — but
    // an EMPTY one is refused by the bridge as `invalid-lookup`, so the page passes something.
    const board = loadBoard();
    board.lookup({ known: true, found: true });
    board.tell({ tasks: TASKS, assignments: [], names: [{ id: "uid-1", name: "山田" }] });
    await settle();

    // ONE press, and no registration in front of it.
    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([{ kind: "submit", cid: "assignments", values: { taskId: "fix-login" } }]);
  });

  it("carries the refusal to the name field, instead of leaving it at the foot of the page", async () => {
    // The reported failure on a PUBLISHED board, and it is not about the write: the guard held and
    // nothing was created — the visitor simply could not see that. `#say` sits under the task list,
    // so the one line it gets is off-screen for anybody who pressed a button further up, and the
    // button is deliberately not disabled. Pressed, considered, and apparently inert.
    //
    // So the page moves to where the answer is. The scroll is the message; the text is the detail.
    const scrolls: unknown[] = [];
    (Element.prototype as unknown as { scrollIntoView: (arg?: unknown) => void }).scrollIntoView = (arg) => {
      scrolls.push(arg);
    };
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });
    await settle();

    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([]);
    expect(board.said()).toContain("先に名前を登録してください");
    expect(scrolls.length).toBeGreaterThan(0);
    expect(document.activeElement?.id).toBe("who");
  });

  it("takes the work after registering, even though `mine.names` is still empty", async () => {
    // The host DID answer — with `[]`, before the registration. Reading the projection first turns
    // that stale empty list into "you have not registered" and refuses somebody who just did, until
    // whenever the next state happens to arrive.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });
    await settle();

    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.press("この名前で参加する");
    await settle();
    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([
      { kind: "submit", cid: "names", values: { name: "山田" } },
      { kind: "submit", cid: "assignments", values: { taskId: "fix-login" } },
    ]);
  });

  it("lets a LATER projection overrule what this visit registered", async () => {
    // The other direction, and the reason the local answer is not simply preferred: the owner can
    // remove a name from the roster. A page that kept its own answer on top would never hear about
    // it and would go on making claims for somebody the roster no longer carries — which is the
    // nameless claim this whole template guards against, arrived at from the far side.
    //
    // So neither wins outright. Whichever was established LAST is the one believed.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });
    await settle();

    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.press("この名前で参加する");
    await settle();

    // The roster is read again and this reader has no row: newer than the registration.
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });
    await settle();

    board.press("これをやります");
    await settle();

    expect(board.sent.map((one) => one.cid)).toEqual(["names"]);
    expect(board.said()).toContain("先に名前を登録してください");
  });

  it("does not let an OVERTAKEN lookup undo the retry a refused registration started", async () => {
    // The narrow ordering, and the one a completed-lookup test cannot reach: the `onState` lookup is
    // STILL OUT when the register button earns its duplicate refusal. Clearing the cache is not
    // enough on its own — the older request took its `found: false` before the row existed, and if
    // it is allowed to land afterwards it puts the negative answer straight back. The visitor is
    // then told to register by a page that has just been told they are registered.
    //
    // So the retry both invalidates what is in flight and goes out itself; the stale reply is
    // dropped on arrival rather than raced with.
    const board = loadBoard();
    board.hold();
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    await settle();
    expect(board.waiting()).toBe(1);

    // The row exists (another tab, or a reply that was lost), so the register press is refused.
    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.answer({ ok: false, error: "permission-denied" });
    board.press("この名前で参加する");
    await settle();

    // The refusal started a fresh lookup rather than being swallowed by the one already out.
    expect(board.waiting()).toBe(2);

    // The OLD one answers first, with the snapshot it took before any of this.
    board.release({ known: true, found: false });
    await settle();
    // Then the one the retry sent, which is the current truth.
    board.release({ known: true, found: true, record: { name: "山田" } });
    await settle();

    board.answer({ ok: true });
    board.press("これをやります");
    await settle();

    expect(board.sent.map((one) => one.cid)).toEqual(["names", "assignments"]);
  });

  it("re-asks after a refused registration, rather than caching 'not registered' for the visit", async () => {
    // A negative answer is a snapshot, not a fact about the rest of the visit. The row can appear
    // afterwards — the same person registering in another tab, or a write whose row landed and
    // whose reply was lost — and the refusal the register button then earns is the ONLY sign of it.
    //
    // Cached, that refusal is a dead end: the take reads "no row", `askHost` never runs again
    // because something is settled, and registering once more only earns the same refusal. Reload
    // is the only way out, which is not something a page may require of somebody.
    const board = loadBoard();
    board.lookup({ known: true, found: false });
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    await settle();

    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.press("これをやります");
    await settle();
    expect(board.sent).toEqual([]);

    // The row exists after all, and the duplicate refusal is how this page finds out.
    board.answer({ ok: false, error: "permission-denied" });
    board.lookup({ known: true, found: true, record: { name: "山田" } });
    board.press("この名前で参加する");
    await settle();

    board.answer({ ok: true });
    board.press("これをやります");
    await settle();

    expect(board.sent.map((one) => one.cid)).toEqual(["names", "assignments"]);
  });

  it("drops a second press while the first write is still out", async () => {
    // The take path crosses an `await` on a host that has resolved nothing, so an impatient second
    // press reads `settled` as false and sends the SAME registration again. No claim comes of it —
    // but the duplicate is refused by the id collision, so the person who did register reads
    // "登録できませんでした" about a registration that worked.
    const board = loadBoard();
    board.hold();
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    await settle();
    board.release({ known: false });
    await settle();

    (document.getElementById("who") as HTMLInputElement).value = "山田";
    // Both presses land before anything is awaited back — the second is dropped, not queued.
    board.press("これをやります");
    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([{ kind: "submit", cid: "names", values: { name: "山田" } }]);
  });

  it("ignores a STALE lookup that lands after a registration succeeded", async () => {
    // The lookup goes out from `onState`, so it is in flight while the visitor is still reading the
    // page — and it was asked BEFORE they registered. If its answer is applied on arrival it
    // overwrites what the register button established, and on a host with no `mine` there is
    // nothing left to correct it: every later take reads "not registered", and registering again
    // only earns the duplicate refusal. The visit is over for that person.
    //
    // Whatever settled first wins. The reply is not wrong, it is old.
    const board = loadBoard();
    board.hold();
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    await settle();

    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.press("この名前で参加する");
    await settle();

    board.release({ known: true, found: false });
    await settle();

    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([
      { kind: "submit", cid: "names", values: { name: "山田" } },
      { kind: "submit", cid: "assignments", values: { taskId: "fix-login" } },
    ]);
  });

  it("SHOWS the name the lookup found, rather than still asking for one", async () => {
    // The answer has to reach the SCREEN, not just the guard. A page that resolved this only inside
    // the take handler goes on drawing the registration form and the "登録済みかは確認できません
    // でした" note over a registration it has just confirmed — the same mistake as reading a missing
    // key as "no", wearing different clothes.
    const board = loadBoard();
    board.lookup({ known: true, found: true, record: { name: "山田" } });
    board.tell({ tasks: TASKS, assignments: [], names: [{ id: "uid-1", name: "山田" }] });
    await settle();

    expect(document.getElementById("who")).toBeNull();
    expect(document.getElementById("me")?.textContent ?? "").toContain("山田");
  });

  it("stops a reader the host says has NO row, without writing a registration first", async () => {
    // The same route answering the other way. `found: false` is an answer, so the page says the
    // useful thing rather than sending a name the reader did not ask to register.
    const board = loadBoard();
    board.lookup({ known: true, found: false });
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    await settle();

    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([]);
    expect(board.said()).toContain("先に名前を登録してください");
  });

  it("takes the work after the REGISTER BUTTON, with no `mine` to confirm it", async () => {
    // The dead end the press-per-write split opened, and it is reached by the ordinary route: the
    // board's own 「この名前で参加する」. Without `mine`, that button is the only thing that knows
    // the name landed — so if it does not record it, the take that follows starts from registration
    // again, meets the id collision (the document id IS the uid), and refuses. The page would have
    // said "登録しました" and then never let that person take anything.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    (document.getElementById("who") as HTMLInputElement).value = "山田";

    board.press("この名前で参加する");
    await settle();
    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([
      { kind: "submit", cid: "names", values: { name: "山田" } },
      { kind: "submit", cid: "assignments", values: { taskId: "fix-login" } },
    ]);
  });

  it("does not let a REFUSED register button stand in for a registration", async () => {
    // The other half: the button records the fallback state only when the write actually landed.
    // A refusal there is the same unknown as before it was pressed.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.answer({ ok: false, error: "host-error" });

    board.press("この名前で参加する");
    await settle();
    board.press("これをやります");
    await settle();

    expect(board.sent.map((one) => one.cid)).toEqual(["names", "names"]);
  });

  it("does NOT take the work when the registration was refused", async () => {
    // The hole the fail-open guard had, in its last form: a refusal is not a registration. "You are
    // already registered" and "that write did not land" come back wearing the same face here, and
    // the page cannot tell them apart — so it stops, because the one it cannot afford to be wrong
    // about is the one that leaves a claim with no name behind it.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] });
    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.answer({ ok: false, error: "host-error" });

    board.press("これをやります");
    await settle();
    board.press("これをやります");
    await settle();

    expect(board.sent.map((one) => one.cid)).toEqual(["names", "names"]);
    expect(board.said()).toContain("登録できませんでした");
  });

  it("asks for the name instead of writing, when nobody looked and none was typed", async () => {
    // The empty field is the only thing left to go on once `mine` is absent, so it is what the page
    // stops at. Nothing is sent — not even the take, which the rules would have accepted.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] });

    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([]);
    expect(board.said()).toContain("先に名前を登録してください");
  });

  it("stops the write when the read DID land and the reader has not registered", async () => {
    // The other side of the same distinction. Here "no rows" is an answer, so the page can say the
    // useful thing instead of sending a write nothing would refuse — the rules do not check the
    // roster, so this one is the PAGE's promise and the only place it is kept.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });

    board.press("これをやります");
    await settle();

    expect(board.sent).toEqual([]);
    expect(board.said()).toContain("先に名前を登録してください");
  });

  it("stops asking once the reader IS registered, and still lets them take work", async () => {
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [{ id: "uid-1", name: "山田" }] }, { names: [{ id: "uid-1", name: "山田" }], assignments: [] });

    // The registration form is gone and the name is shown back — the screen a reload has to produce
    // as well, which is why it is drawn from `mine` rather than from what the last submit returned.
    expect(document.getElementById("who")).toBeNull();
    expect(document.getElementById("me")?.textContent ?? "").toContain("山田");

    board.press("これをやります");
    await settle();
    expect(board.sent).toEqual([{ kind: "submit", cid: "assignments", values: { taskId: "fix-login" } }]);
  });

  it("does not let a page that has been replaced answer a click", async () => {
    // The harness's own guard, and it is about the SUBJECT of this file: every case here asserts
    // which control did what, and a leaked listener answers through the parent it captured. Both
    // pages delegate one `click` handler on the document, jsdom shares that document across a
    // file, and the labels are the template's own — so a page loaded earlier matches the same
    // press. Nothing would throw; the count would simply be one somewhere nobody was looking.
    // Told a registered reader, so one press is exactly one write and the count is unambiguous.
    const registered = { names: [{ id: "uid-1", name: "山田" }], assignments: [] };
    const gone = loadBoard();
    gone.tell({ tasks: TASKS, assignments: [], names: [{ id: "uid-1", name: "山田" }] }, registered);
    const shown = loadBoard();
    shown.tell({ tasks: TASKS, assignments: [], names: [{ id: "uid-1", name: "山田" }] }, registered);

    shown.press("これをやります");
    await settle();

    expect(shown.sent).toHaveLength(1);
    expect(gone.sent).toEqual([]);
  });

  it("shows the owner's instructions to the person who took the work", () => {
    // `detail` and `due` are filled in by the owner and were drawn nowhere: the sort used the date
    // and the board showed neither. Work nobody can read the instructions for is work that does not
    // get done.
    const board = loadBoard();
    board.tell({ tasks: [{ id: "fix-login", title: "ログインを直す", detail: "再現手順は issue #12", due: "2026-09-01" }], assignments: [], names: [] });

    const text = document.getElementById("list")?.textContent ?? "";
    expect(text).toContain("再現手順は issue #12");
    expect(text).toContain("2026-09-01");
  });

  it("offers the finish and the withdrawal only on the reader's OWN row", async () => {
    // Which rows are theirs comes from `mine.assignments`, whose ids ARE the task ids — the uid is
    // dropped from the projection, so a page comparing `row.uid` to something it never received
    // compares undefined with undefined and draws the controls on everybody's row or nobody's.
    const board = loadBoard();
    const theirs = [{ id: "fix-login", uid: "uid-1", status: "doing" }];
    board.tell({ tasks: TASKS, assignments: theirs, names: [] }, { names: [{ id: "uid-1" }], assignments: [] });
    expect(board.buttons()).toEqual([]);

    board.tell({ tasks: TASKS, assignments: theirs, names: [] }, { names: [{ id: "uid-1" }], assignments: [{ id: "fix-login" }] });
    expect(board.buttons()).toContain("完了にする");

    // And the withdrawal asks first, in the page: `confirm()` is ignored by the sandbox and answers
    // false, so a guard written with it makes the button do nothing at all.
    board.press("アサインを外す");
    expect(board.sent).toEqual([]);
    board.press("本当に外す");
    await settle();
    expect(board.sent).toEqual([{ kind: "withdraw", cid: "assignments", id: "fix-login" }]);
  });

  /** The row a refused take was aimed at, if the page marked one. */
  const wantedRow = (): HTMLElement | null => document.querySelector(".task.wanted");
  const wantedNote = (): string => wantedRow()?.querySelector("p.ask")?.textContent ?? "";

  it("carries the intent through the registration, instead of dropping it", async () => {
    // The confusion this exists to stop, reported from a published board: somebody presses
    // これをやります without a name, is carried to the name field, registers — and leaves believing
    // they took the work. `#me` turns into "…として参加中です", which reads as success, while the
    // half that matters is a line in `#say` at the foot of a page they were just scrolled away from.
    //
    // One press writes once (see `ensureRegistered`), so the second press cannot be removed. What
    // is removed here is not KNOWING that a second press is owed.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });

    board.press("これをやります");
    await settle();
    // Refused, nothing written, and the task is now marked — pointing FORWARD, because this person
    // has not registered yet. Saying "登録できました" here would be the same lie in a new place.
    expect(board.sent).toEqual([]);
    expect(wantedRow()?.dataset.task).toBe("fix-login");
    expect(wantedNote()).toContain("名前を登録したら");

    (document.getElementById("who") as HTMLInputElement).value = "山田";
    board.press("この名前で参加する");
    await settle();

    // The roster row was written and NOTHING else. `#say` names the thing that did not happen,
    // rather than the thing that did, and the row now carries the one press still owed.
    expect(board.sent.map((one) => one.cid)).toEqual(["names"]);
    expect(board.said()).toContain("まだ引き受けていません");
    expect(wantedNote()).toContain("もう一度");

    board.press("これをやります");
    await settle();
    expect(board.sent.map((one) => one.cid)).toEqual(["names", "assignments"]);
    // And the note goes with the press it was asking for. Left standing, it tells somebody who has
    // already taken the work that they still have to take it.
    expect(wantedRow()).toBeNull();
  });

  it("does not promise a second press for work somebody else took while the name was typed", async () => {
    // A board with people on it loses the race often. Repeating "もう一度押すと引き受けます" over a
    // task that is no longer free is pointing at a button that is not drawn.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });
    board.press("これをやります");
    await settle();

    board.tell({ tasks: TASKS, assignments: DOING, names: [] }, { names: [{ id: "uid-9" }], assignments: [] });

    expect(wantedNote()).toContain("ほかの人が取りました");
    expect(board.buttons()).not.toContain("これをやります");
  });

  it("keeps a typed name when the board redraws under it", async () => {
    // `render()` runs on presses now, not only on state, and `drawMe` used to rebuild the form every
    // time — which took the focus `refuse()` had just placed AND whatever had been typed. The second
    // one is the expensive half: the retry after a failed registration then goes out empty, so a
    // host error turns into "先に名前を登録してください" for somebody who did type a name.
    const board = loadBoard();
    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });
    const field = document.getElementById("who") as HTMLInputElement;
    field.value = "山田";
    field.focus();

    board.tell({ tasks: TASKS, assignments: [], names: [] }, { names: [], assignments: [] });

    expect((document.getElementById("who") as HTMLInputElement).value).toBe("山田");
    expect(document.activeElement?.id).toBe("who");
  });
});
