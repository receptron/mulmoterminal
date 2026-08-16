// What the parent's own words MEAN, in one place, for everything that explains a view to its author.
//
// Two things say these sentences now and they must not say them differently: the headless run an
// agent starts (`server/backends/sharedApp/headlessReport.ts`) and the log an author copies out of
// the Collections pane (`src/utils/sharedAppPreviewLog.ts`). Both are read by the same reader —
// often a language model, sometimes the person — about the same page, and the two arriving in
// different vocabularies would make an author reconcile two accounts of one failure before they
// could start on the failure.
//
// In `common/` because that is what the rule says (CLAUDE.md): a value BOTH sides decide from lives
// here rather than mirrored with a comment asking somebody to keep two copies in step.
//
// These are the explanations. What each host does with them — a per-page report, a timeline — is
// its own, and stays there.
import type { ViewNoticeCode } from "@receptron/sharedapp/view";
import type { PreviewAudience } from "./sharedAppPreview.js";

/** What the parent's refusals mean.
 *
 *  None of these ever reaches a screen: they are answered on the port, into a promise the page
 *  usually does not await. So this is the only place an author can learn that the page asked for
 *  something the declaration does not allow — and the page, meanwhile, showed whatever it shows
 *  when nothing comes back. */
export const REFUSALS: Record<string, string> = {
  "unknown-collection": "the page submitted to a collection this app's `public.submit` does not declare",
  "undeclared-field": "the page sent a field that is not in that collection's `createFields`",
  "not-a-submission":
    "the message was not a submission at all — most often a value that is not a string (the rules compare stored values without coercing, so only strings may be sent)",
  busy: "a confirmation was already open (the page submitted twice)",
  cancelled: "the confirmation was declined",
};

/** What a member or participant page is told when it asks for a write.
 *
 *  `transition`, `assign` and `withdraw` reach the member parent, which judges them and would
 *  perform them on the live page — here it has nowhere to write, so it answers `read-only`. That
 *  is a GOOD outcome and has to read like one: the ask arrived, in the right shape, and was
 *  declined for the reason every preview declines a write.
 *
 *  It replaced a longer note saying the parent answering intents "is not the one running here",
 *  which was true while the preview had only the public bridge and is not any more. */
export const READ_ONLY_ON_A_MEMBER_PAGE =
  "the preview does not write, so it declined. The ask itself was well formed and reached the parent — this line means the control is wired, not that anything is wrong. " +
  "Whether the deployed rules would accept the write is a different question and is not answered here.";

/** One refusal, in the words that fit the page it happened on. */
export const explainRefusal = (reason: string, audience: PreviewAudience): string => {
  if (reason === "read-only" && audience !== "public") return READ_ONLY_ON_A_MEMBER_PAGE;
  return REFUSALS[reason] ?? reason;
};

/** What a page that never answered the handshake is doing, and the one thing that causes it. */
export const READY_DEADLOCK =
  "It NEVER answered the handshake, so the parent sent it no records at all — this is the page that sits on its loading state forever. " +
  "`ready()` has to be called OUTSIDE the `onState` callback: inside it, it can never run, because the parent sends no state until `ready` arrives.";

/** Why a `<form>` is a dead control here, in the words of what the browser actually does. */
export const FORM_BLOCKED =
  "A form cannot submit here: the frame is sandboxed without `allow-forms`, and the browser blocks the submission BEFORE firing the `submit` event — so an " +
  '`onsubmit` handler with `e.preventDefault()` as its first line never runs. Use a `<div>` with a `type="button"` button and a click handler.';

/** What the frame reported about ITSELF, and what to do about each.
 *
 *  The codes come from `@receptron/sharedapp/view`, which normalises anything it does not know to
 *  `unknown` — so this map is over a closed set and an entry that goes missing is a type error
 *  rather than a code printed raw. */
export const NOTICES: Record<ViewNoticeCode, string> = {
  error: "the page raised an error nothing caught. Everything after the throw did not run, which is usually why the screen stopped where it did",
  "unhandled-rejection": "a promise the page made was rejected and nothing handled it. Most often an `await` on a request that was refused",
  "modal-ignored":
    "the page called a modal the sandbox IGNORES. `alert`, `confirm` and `prompt` do nothing here and do nothing on the published page either — `confirm` answers " +
    "false, so the page carries on as though the visitor had said no. Ask with an `<input>`, say things in the page, and confirm by pressing twice",
  "notices-dropped":
    "the page reported more of the above than this runtime carries, and the rest were not sent. The ones above are the earliest, which are usually the cause",
  unknown: "the page reported something under a name this host does not know. The name itself is not repeated here — it is a string the page chose",
};

/** Page-controlled text, put into a report so it cannot be mistaken for the report's own words.
 *
 *  `JSON.stringify` rather than a pair of quotes: a label reading `Save "draft"` or a screen with a
 *  newline in it would otherwise end a quotation early, and the reader — frequently a model being
 *  asked what went wrong — cannot tell a quotation mark the page wrote from one a host did. */
export const quoteForReport = (text: string): string => JSON.stringify(text);
