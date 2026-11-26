---
name: mulmoterminal-html-plan
description: Plan a change as an interactive HTML page the user decides on, instead of a wall of text. Lays out what is settled, what is assumed and what is still open; shows each real choice as live mockups or controls the user can try; and ends with a Send button that hands the user's decisions back to you as their next message. Opens in the pane on the right of the terminal (presentHtml). Use when the user asks for a plan, a spec or a design they want to look at and choose from, says "show me options", "mock it up", "HTML plan", or when a plan has several open choices that are easier to see than to describe. Works in whatever language the user writes in.
---

# Plan in HTML, let the user decide, take the result back

A text plan asks the user to imagine the options. A page shows them. The point of this skill is the
round trip: you lay out the plan, the user tries the choices and settles them on the page, and their
decisions come back to you as a message you can act on. You do not ask the questions one by one in
the terminal; the page asks them all at once, where they can be seen side by side.

## 0. Check for `presentHtml` before anything else

The whole round trip runs through `presentHtml`. In a project directory it exists only when
**Canvas** was switched on before the session started. If you do not have it, stop here — before
reading code or drafting a page — and tell the user: switch on Canvas for this folder in the
launcher's MCP toggles, then start the cell again and ask once more.

Do not work around a missing tool. Posting to the server's `/api/mcp/…` yourself, writing the page
to a file, or opening it in a browser does not put it in the pane beside this terminal, and a Send
pressed anywhere else never reaches you — the user decides everything and it is lost.

## 1. Know what you are planning before you draw anything

Read the request, the code it touches and the project's own instructions (`CLAUDE.md`, `AGENTS.md`,
existing plans). Then sort everything you know into three piles:

- **Settled** — the user said so, or the code leaves no choice.
- **Assumed** — your best reading, which the user may want to correct.
- **Open** — a real choice with more than one reasonable answer.

Only the third pile becomes controls on the page. If it is empty, you do not need this skill: write
the plan and get on with it. Keep the user's words for what they asked; do not grow a small change
into a strategy document.

## 2. Build one self-contained page

One HTML document, everything inline. What the page can and cannot do:

- Scripts and styles inline, or from the allowed CDNs (`cdn.jsdelivr.net`, `unpkg.com`,
  `cdnjs.cloudflare.com`, `cdn.plot.ly`, Google Fonts). Anything else is blocked silently.
- **No `fetch` or XHR.** Connections from the page's own script are blocked, so put the data the
  page needs into it. Loading a library from those CDNs, and images or media over `https:`, still
  works.
- **No storage.** The page runs in a sandbox with an opaque origin: `localStorage` and cookies
  throw. Keep state in variables.

Shape it around the decisions, roughly in this order — leave out any part that has nothing in it:

1. **What this is** — one or two sentences: the goal and what is out of scope.
2. **Settled** — a short list, so the user can see you understood.
3. **Assumed** — each assumption with a control to flip it (a checkbox, a "no, actually…" text box).
4. **Choices** — one block per open question. Show the options, not just their names:
   - a UI choice: render each option as a small live mockup (real labels, real data shape, no
     lorem ipsum), side by side, with a radio to pick one;
   - an API or data choice: the code or the JSON each option produces, side by side;
   - an ordering or priority: a list the user can reorder;
   - a number (a limit, a timeout, a size): a slider or input with the consequence shown next to it.
   Say what each option costs in one line. Mark your recommendation, and preselect it.
5. **Steps** — the implementation sequence, only where the order is real. Let it react to the
   choices above when they change the steps.
6. **Risks** — only ones you can name concretely.
7. **What will be sent** — a live summary of every decision as it stands, updated as the user
   clicks, so nothing is sent that they have not seen.

Do not invent timelines, percentages or status badges the plan does not support.

## 3. End with a Send button

The button posts the summary to the host. Presented as in step 4 — written with `html` and passed
`submit: "direct"` — and carrying the key the host put in the page's own URL, it reaches you as soon
as the user presses the button. Anything else (no key, a page opened by `path`, a second press
within a few seconds) is shown to the user in a confirmation bar above the page first, and reaches
you when they press Send there.

```html
<button id="send">Send these decisions</button>
<script>
  function summary() {
    const lines = ["Decisions for: <the plan's title>"];
    // one line per decision: what it is, and what the user chose — never just "B"
    lines.push(`Layout: ${document.querySelector("input[name=layout]:checked").value}`);
    lines.push(`Notes: ${document.getElementById("notes").value || "(none)"}`);
    return lines.join("\n");
  }
  // The host puts a fresh key in this page's URL; a page the frame moves to later does not have it.
  const key = new URLSearchParams(location.hash.slice(1)).get("mulmo-submit-key");
  document.getElementById("send").onclick = () =>
    window.parent.postMessage({ type: "mulmo-html-submit", text: summary(), key }, "*");
</script>
```

- `text` is plain text, at most 20,000 characters. Longer is refused, not shortened.
- Send only from the button. Never post on load or on every change: with `submit: "direct"` each post
  reaches the conversation as the user's message.
- Write each line so it stands on its own when it arrives in the terminal: name the decision and
  the option chosen, include anything typed into a free-text box, and mark an assumption the user
  overturned.
- Include the unchanged recommendations too. "Kept your suggestion" is a decision.

## 4. Present it and stop

Call `presentHtml` with the page as `html`, a short `title`, and `submit: "direct"`. Pass that flag
only for a page you wrote just now for this — never for a page whose script you did not write. If
the user wants the plan kept in the project (for example beside other plans), write the file there
and present it with `path` instead; the flag does not apply to `path`, so their Send then goes
through the confirmation bar.

Then **finish your turn.** Do not wait, poll or ask in the terminal whether they are done. Tell them
in a sentence what to decide on the page and that Send hands it back.

## 5. When the decisions arrive

They come in as the user's next message, in the shape your `summary()` produced. Then:

1. Read every line back against the plan. If a choice contradicts something settled, or leaves a
   question that blocks the work, ask about that one thing — do not re-send the page.
2. If the decisions change the plan materially, present an updated page — with `html` and
   `submit: "direct"` again if they need to choose again — and say what changed.
3. Otherwise go ahead with the work, in the order the plan's steps give.

If the user edits the page itself or asks for another option, rewrite it and present it again; a
reload drops any decision that was waiting to be sent, so they choose again on the new page.
