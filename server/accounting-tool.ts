// MCP tool definition for the accounting plugin (manageAccounting).
//
// Vendored from MulmoClaude's host-side src/plugins/accounting/definition.ts: the
// @mulmoclaude/accounting-plugin package owns the Vue View + the Express router, but
// the tool DEFINITION + execute live host-side in each shell (the package exposes no
// gui-chat-protocol `.` core entry). So MulmoTerminal carries its own copy here and
// registers manageAccounting as a HOST TOOL (see server/host-tools.ts +
// the /api/plugin/manageAccounting dispatch route in server/index.ts), whose execute
// passes through to POST /api/accounting — exactly MulmoClaude's passthrough.
//
// Only the curated enum VALUES are imported from the package's shared entry so this
// list can't drift from the service-layer guards; the prose is copied verbatim.
import type { ToolDefinition } from "gui-chat-protocol";
import {
  ACCOUNTING_ACTIONS,
  SUPPORTED_COUNTRY_CODES,
  FISCAL_YEAR_ENDS,
  TIME_SERIES_GRANULARITIES,
  TIME_SERIES_METRICS,
} from "@mulmoclaude/accounting-plugin/shared";

export const MANAGE_ACCOUNTING: ToolDefinition = {
  type: "function",
  name: "manageAccounting",
  prompt:
    "When the user asks to open / view their books, or to record, look up, or summarise journal entries / balances / opening balances, use manageAccounting. Use action='openBook' (with the target bookId) to switch the canvas to a specific existing book; use the specific action (addEntries / getReport / etc.) for narrowly-scoped operations the user asked about by name. On a fresh workspace call 'createBook' (always pass `country` so tax-registration advice is country-aware) — the accounting view picks up the new book automatically (no follow-up 'openBook' needed for this id). Use 'updateBook' to change a book's name or country (currency cannot be changed). Reach for 'openBook' only when switching to a different existing book. For cross-period charts and dashboards (\"chart my quarterly revenue over the last two years\", \"show net income month-over-month for this fiscal year\", \"plot the cash balance by month\") use action='getTimeSeries' — it returns one chart-ready point per bucket in a single round-trip; do NOT loop over 'getReport' to assemble a series yourself.",
  description:
    "Manage a double-entry accounting book stored in the workspace file system. Supports multiple books (entities), opening balances for adoption from existing books, journal entries, voiding (append-only — corrections are reversing pairs), and balance-sheet / profit-loss / ledger reports. Action='openBook' mounts the full accounting UI in the canvas (requires bookId); 'getTimeSeries' returns chart-ready (label, value)[] series for revenue / expense / netIncome / accountBalance over time; specific actions return compact results that render inline.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: Object.values(ACCOUNTING_ACTIONS),
        description:
          "Operation to perform. 'openBook' mounts the full UI for a specific book; others perform a single read or write. Use 'openBook' when the user wants to browse / interact, and a specific action when the user named the operation.",
      },
      bookId: {
        type: "string",
        description:
          "Target book id. Required for every action that reads or writes book data, including 'openBook'; call 'getBooks' first to enumerate available ids. The only actions that do NOT take a bookId are 'getBooks' and 'createBook' (which creates a fresh one).",
      },
      // openBook / createBook / updateBook
      name: { type: "string", description: "For 'createBook' / 'updateBook': human-readable book name." },
      currency: {
        type: "string",
        description: "For 'createBook': ISO 4217 currency code (default USD). Single-currency per book — cannot be changed once set.",
      },
      country: {
        type: "string",
        enum: [...SUPPORTED_COUNTRY_CODES, ""],
        description:
          "For 'createBook' / 'updateBook': ISO 3166-1 alpha-2 country code identifying the tax jurisdiction. Drives country-aware advice — e.g. when set to 'JP', strongly suggest the supplier's T-number (適格請求書発行事業者登録番号) on tax-related lines under インボイス制度. Only the codes listed in the enum are accepted; pass an empty string to 'updateBook' to clear the field.",
      },
      fiscalYearEnd: {
        type: "string",
        enum: [...FISCAL_YEAR_ENDS],
        description:
          "For 'createBook' / 'updateBook': which calendar-quarter end is this book's fiscal year end — Q1 = March 31, Q2 = June 30, Q3 = September 30, Q4 = December 31 (calendar year, the default). Drives the date-range shortcuts in the UI ('current quarter', 'current year', etc.). Pure metadata: changing it does not move existing entries.",
      },
      initialTab: { type: "string", description: "For 'openBook': initial tab to show (e.g. 'journal', 'opening', 'balanceSheet')." },
      confirm: { type: "boolean", description: "For 'deleteBook': must be true to actually delete (guard against accidental deletion)." },
      // accounts
      account: {
        type: "object",
        description: "For 'upsertAccount': the account to insert or update (matched by code).",
        properties: {
          code: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["asset", "liability", "equity", "income", "expense"] },
          note: { type: "string" },
          active: {
            type: "boolean",
            description:
              "Soft-delete flag. `false` deactivates the account (hides it from entry / ledger dropdowns while keeping it visible in Manage Accounts and historical entries — accounting integrity requires that a code referenced by a journal line never disappears). `true` reactivates a previously-deactivated account. Omit to preserve the existing state — handy when updating name / type / note without touching the active flag.",
          },
        },
        required: ["code", "name", "type"],
      },
      // entries (addEntries — batched)
      entries: {
        type: "array",
        description:
          "For 'addEntries': one or more journal entries to post atomically (all-or-nothing — if any entry fails validation, the whole batch is rejected and nothing is written). Use a single-element array to post one entry. Each entry has its own date, lines, optional memo, and optional replacesEntryId.",
        items: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD booking date." },
            lines: {
              type: "array",
              description: "Journal lines for this entry. Each line sets exactly one of debit or credit (positive amount). Σ debit must equal Σ credit.",
              items: {
                type: "object",
                properties: {
                  accountCode: { type: "string" },
                  debit: { type: "number" },
                  credit: { type: "number" },
                  memo: { type: "string" },
                  taxRegistrationId: {
                    type: "string",
                    description:
                      "Optional counterparty tax-authority registration ID for this line (Japan T-number, EU VAT ID, UK VAT registration number, India GSTIN, Australia ABN, etc.). Free-form string, max 32 chars. Required for input-tax-credit eligibility under regimes like Japan's インボイス制度.",
                  },
                },
                required: ["accountCode"],
              },
            },
            memo: { type: "string", description: "Optional entry-level memo." },
            replacesEntryId: {
              type: "string",
              description:
                "Optional — id of an entry this one replaces (the 'edit' flow). The caller MUST issue a 'voidEntry' for that id immediately before this addEntries call; the void + post pair is not atomic on the server.",
            },
          },
          required: ["date", "lines"],
        },
      },
      // setOpeningBalances — single opening entry (top-level lines / memo)
      lines: {
        type: "array",
        description:
          "For 'setOpeningBalances': journal lines. Each line sets exactly one of debit or credit (positive amount). Σ debit must equal Σ credit. Only balance-sheet accounts (asset / liability / equity) are accepted.",
        items: {
          type: "object",
          properties: {
            accountCode: { type: "string" },
            debit: { type: "number" },
            credit: { type: "number" },
            memo: { type: "string" },
            taxRegistrationId: { type: "string" },
          },
          required: ["accountCode"],
        },
      },
      memo: { type: "string", description: "For 'setOpeningBalances': optional entry-level memo." },
      // void
      entryId: { type: "string", description: "For 'voidEntry': id of the entry to void. The reverse + marker pair is appended (journal stays append-only)." },
      reason: { type: "string", description: "For 'voidEntry': human-readable reason." },
      voidDate: { type: "string", description: "For 'voidEntry': YYYY-MM-DD date for the reverse entry (defaults to today)." },
      // getJournalEntries / getReport / getTimeSeries ranges
      from: {
        type: "string",
        description:
          "For 'getJournalEntries': inclusive YYYY-MM-DD lower bound on entry date. For 'getTimeSeries': inclusive YYYY-MM-DD lower bound — the first bucket is the one CONTAINING this date (it can extend earlier).",
      },
      to: {
        type: "string",
        description:
          "For 'getJournalEntries': inclusive YYYY-MM-DD upper bound on entry date. For 'getTimeSeries': inclusive YYYY-MM-DD upper bound — the last bucket is the one CONTAINING this date (it can extend later).",
      },
      accountCode: {
        type: "string",
        description:
          "For 'getJournalEntries' / 'getReport' (kind=ledger): filter to entries that touch a specific account code. For 'getTimeSeries' with metric='accountBalance': REQUIRED — the account whose closing balance to plot per bucket. Forbidden for the other metrics.",
      },
      // getTimeSeries
      metric: {
        type: "string",
        enum: [...TIME_SERIES_METRICS],
        description:
          "For 'getTimeSeries': what to plot per bucket. 'revenue' = sum of income-account presentation values within the bucket (positive = money earned). 'expense' = sum of expense accounts within the bucket (positive = money spent). 'netIncome' = revenue − expense (positive = profit). 'accountBalance' = closing balance of `accountCode` at the end of each bucket (cumulative, includes opening balances).",
      },
      granularity: {
        type: "string",
        enum: [...TIME_SERIES_GRANULARITIES],
        description:
          "For 'getTimeSeries': bucket size. 'month' uses calendar months (label format YYYY-MM). 'quarter' and 'year' honour the book's fiscalYearEnd — for a Q4 book they coincide with calendar quarters / years; Q1/Q2/Q3 books shift accordingly. Quarter labels are 'FY{endYear}-Q{1..4}', year labels are 'FY{endYear}'; the FY is named by its END calendar year (e.g. an FY running Apr 2025 – Mar 2026 is FY2026).",
      },
      // opening
      asOfDate: {
        type: "string",
        description: "For 'setOpeningBalances': YYYY-MM-DD date the balances are stated as-of. Must be on or before any existing entry.",
      },
      // getReport
      kind: {
        type: "string",
        enum: ["balance", "pl", "ledger"],
        description: "For 'getReport': which report. 'balance' = balance sheet; 'pl' = profit & loss; 'ledger' = per-account running balance.",
      },
      period: {
        type: "object",
        description: "For 'getReport': either a single closing month or a date range.",
        properties: {
          kind: { type: "string", enum: ["month", "range"] },
          period: { type: "string", description: "For kind='month': YYYY-MM." },
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["kind"],
      },
    },
    required: ["action"],
  },
};
