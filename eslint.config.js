import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import sonarjs from "eslint-plugin-sonarjs";
import security from "eslint-plugin-security";
import prettierRecommended from "eslint-plugin-prettier/recommended";

// Take a preset at its word about WHICH rules to run, and overrule it on how much they matter: a
// warning does not fail CI, so a rule left at warn is a rule that reports a violation and ships it.
// This repo has the receipt — `max-params` sat at warn behind a note saying to raise it once its one
// offender was resolved, the offender was resolved, nobody raised it, and two new violations arrived
// in the shadow of the note (#1682). Warn is for a human reading output; nothing here reads output.
//
// Written as a transform rather than a list of rule names because the list is what rots: a preset
// that adds a warn-level rule in some future release arrives already enforced, instead of silently
// re-opening the gap this closes. Severity only — the preset's own options are preserved, and a rule
// it ships as `off` stays off (it chose not to run it, which is a different decision).
//
// A rule that genuinely must not fail the build gets turned off, by name, with the reason, in one of
// the blocks below. Warn is the state in between, and it does not survive contact with time: it is
// either a decision that has expired — the two promise rules further down were held at warn while
// their findings were read down to zero, and then stayed there — or no decision at all.
const raise = (entry) => {
  const severity = Array.isArray(entry) ? entry[0] : entry;
  if (severity !== 1 && severity !== "warn") return entry;
  return Array.isArray(entry) ? ["error", ...entry.slice(1)] : "error";
};

const enforced = (config) =>
  config.rules ? { ...config, rules: Object.fromEntries(Object.entries(config.rules).map(([id, entry]) => [id, raise(entry)])) } : config;

export default [
  { ignores: ["dist/", "node_modules/"] },
  {
    // A disable comment that no longer suppresses anything is worse than none: it names a rule as
    // the reason for the code below it, and that reason has stopped being true. ESLint reports
    // these at warn by default, which is how one for `no-new-func` — a rule this config does not
    // even enable — sat in a spec. At error the comment has to be narrowed when it goes stale.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  enforced(js.configs.recommended),
  ...tseslint.configs.strict.map(enforced),
  ...pluginVue.configs["flat/recommended"].map(enforced),
  enforced(sonarjs.configs.recommended),
  enforced(security.configs.recommended),
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: ["./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
      // Components are styled with Tailwind utilities (docs/styling.md) so the styling
      // travels with the markup. A <style> block is the exception, not the default —
      // add the file to the allowlist below WITH a reason rather than disabling inline.
      "vue/no-restricted-block": [
        "error",
        {
          element: "style",
          message:
            "Use Tailwind utilities (see docs/styling.md). If this genuinely can't be a utility, add the file to the scoped-CSS allowlist in eslint.config.js with a reason.",
        },
      ],
      // The assertion bans below reach `<script>` only: typescript-eslint's rules never visit
      // the TEMPLATE body, which vue-eslint-parser exposes as a separate AST. So
      // `@input="…($event.target as HTMLInputElement).value"` was invisible to
      // consistent-type-assertions even at `error`, and `!` was invisible to
      // no-non-null-assertion. `vue/no-restricted-syntax` is the one rule that walks that AST,
      // so the same two bans are spelled here as selectors.
      "vue/no-restricted-syntax": [
        "error",
        {
          // `as const` is excluded, because consistent-type-assertions excludes it too and the
          // two halves of one SFC must not disagree. It is also not what the ban is about: a
          // const assertion narrows a literal the compiler can already see, rather than claiming
          // a type the compiler could not prove.
          selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
          message: "Do not use type assertions — narrow in <script> and pass the result to the template.",
        },
        {
          selector: "TSNonNullExpression",
          message: "Do not use non-null assertions — narrow in <script> and pass the result to the template.",
        },
      ],
    },
  },
  {
    // Scoped-CSS allowlist. Each entry is something Tailwind utilities cannot express;
    // keep the reason current, and delete the entry when the reason goes away.
    files: [
      "src/components/Sidebar.vue", //            @keyframes — the "thinking" spinner ring
      "src/components/SessionTabBar.vue", //      @keyframes — the same spinner
      "src/components/Terminal.vue", //           @keyframes — the voice button's pulse / spin
      "src/components/TerminalGrid.vue", //       parent-state x descendant layout machine + FLIP @keyframes
      "src/components/GuiPanel.vue", //           `.frame + .frame` sibling-combinator spacing
      "src/components/WikiPageView.vue", //       :deep into v-html markdown
      "src/components/WikiBrowseOverlay.vue", //  :deep into v-html lint output
      "src/components/FilesOverlay.vue", //       :deep into CodeMirror's injected root
      "src/components/ToolbarPopover.vue", //     shared popover chrome import
    ],
    rules: { "vue/no-restricted-block": "off" },
  },
  {
    files: ["server/**/*.{js,mjs}", "bin/**/*.js", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The launcher's job is to run the user's installed CLIs — claude, gh, tmux,
    // codex, git — which have no portable absolute path and are found on PATH by
    // design. no-os-command-from-path fights that premise on every spawn, so it
    // is off here rather than suppressed inline at each call.
    files: ["bin/**/*.js"],
    rules: {
      "sonarjs/no-os-command-from-path": "off",
    },
  },
  {
    // Complexity / size guards. Cognitive complexity is already covered by sonarjs
    // (error@15). All ERRORS — including max-params, which spent long enough as a WARN to
    // show what a warning is worth here: it was left at warn for spawnClaudePty's 7 params,
    // that function became an options object and took itself off the list, nobody flipped the
    // rule, and TWO new offenders arrived in its shadow (one at nine). A rule nothing enforces
    // is a rule that documents the violation it invites.
    //
    // max-lines is per FILE and was the gap: the per-function guards were all passing while
    // TerminalCell.vue reached 2000 lines, because nothing was watching the file. Counted
    // without comments, which is why the three heavily-documented 800+ line files
    // (useTerminalConnections.ts, server/index.ts, collections.ts) are already under it —
    // long because they explain themselves, not because they do too much.
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      // Both of these read a FIXTURE as if it were a deployment detail. `no-hardcoded-ip` exists
      // to catch a real endpoint baked into shipped code instead of configuration; in a spec the
      // address IS the input under test, and the alternative — assembling `192.168.64.1` from
      // pieces to get past the rule — hides what the case is about. `publicly-writable-directories`
      // reads a `/tmp/...` string the same way, and a spec's is a string nothing opens.
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/publicly-writable-directories": "off",
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["error", 6],
      "max-nested-callbacks": ["error", 4],
    },
  },
  {
    // no-redundant-optional assumes `?: T` already admits undefined, so `?: T | undefined`
    // says nothing new. Every tsconfig here sets exactOptionalPropertyTypes, which makes the
    // two DIFFERENT types — `?: T` forbids the key from holding undefined — so the rule's
    // premise no longer holds and it flags the only way to spell "undefined is a valid value".
    // Turn it back on if the flag ever comes off.
    rules: {
      "sonarjs/no-redundant-optional": "off",
    },
  },
  {
    // `const { secret, ...rest } = obj` is how you drop a field by construction —
    // the named siblings are the point, not dead code. Scoped to where the
    // typescript-eslint rule owns unused-vars; plain .js keeps the plugin default.
    files: ["**/*.{ts,tsx,mts,cts}", "**/*.vue"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // `as` casts, which CLAUDE.md forbids ("MUST use type guards instead") and nothing was
    // enforcing — so they accumulated to 90 in the app while the rule existed only on paper.
    // A cast asserts a type the compiler could not prove; a type guard PROVES it, and the
    // difference shows up at runtime, on the data you least control.
    //
    // ERROR since #1231 finished: the 149 assertions the app started with are gone, and the
    // allowlist below is the only way to keep one — with a reason, since inline eslint-disable is
    // forbidden and hides the debt at the scene.
    //
    // `**/*.vue` here reaches the SCRIPT block only — typescript-eslint's rules never walk the
    // template AST, so an `as` inside `@input="…"` passed this rule at `error` (#1339). The same
    // ban for the template is the `vue/no-restricted-syntax` selectors in the `.vue` block above.
    files: ["**/*.{ts,tsx,mts,cts}", "**/*.vue"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  {
    // Type-aware lint, on the APP ONLY — the two promise rules from #1301's sibling (#1300).
    //
    // Scoped to server/src/common rather than everything: the type program is the whole cost of
    // this pass, so keeping tests out of it keeps that program smaller. These started at WARN for
    // the reason #1231 did — keep the count visible without CI going red while the real findings
    // are read one at a time. That reading finished: the count has been zero since, so the warning
    // had nothing left to show and they are errors now (#1688).
    //
    // Only these two: they catch things NO syntactic rule can. A missing `await` makes a rejection
    // vanish and the call look like it succeeded; an async callback handed to an API that ignores
    // the returned promise does the same. The `no-unsafe-*` family is the rest of #1300 and is a
    // separate piece of work — 139 findings that mostly say "this is untyped", not "this is wrong".
    //
    // .ts only. A .vue file needs vue-eslint-parser as the PARSER (with tseslint.parser underneath
    // for the script block), and pointing tseslint.parser straight at one fails to parse the SFC.
    // Wiring type info through the Vue block is its own change; the promise mistakes this catches
    // live in the composables and the server either way.
    files: ["server/**/*.ts", "src/**/*.ts", "common/**/*.ts"],
    // Specs are out, as #1300 asks: they are not in either project, so the parser cannot place
    // them — and keeping them out is what keeps the type program small.
    ignores: ["**/*.spec.ts", "**/*.test.ts"],
    languageOptions: {
      parser: tseslint.parser,
      // Explicit projects, not `projectService: true`: the root tsconfig.json references only
      // app and node, so the service could not place any server/** file and reported 321 parse
      // errors. Naming both projects is what actually covers the code these rules are for.
      // `extraFileExtensions` here even though this block never lints a .vue: it names the same
      // tsconfig.app.json as the .vue block above, and the type program is cached per tsconfig. A
      // program built from THIS block without it holds no .vue file, so whoever builds first
      // decides whether SFCs can be placed — invisible single-threaded, 95 parse errors under
      // `--concurrency`, where each worker builds its own.
      parserOptions: {
        project: ["./tsconfig.app.json", "./tsconfig.server.json"],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // Two more from the type-aware family, at ERROR because both are now at zero and each
      // catches something no syntactic rule can: an `await` on a value that is not a promise
      // (which reads as async and is not), and a template/String() that turns an object into the
      // literal text "[object Object]" — a wrong value that travels instead of throwing.
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-base-to-string": "error",
      // The `any` family (#1300). All five are at ZERO, and they are the rules that catch what
      // `no-explicit-any` cannot: an `any` that arrives from outside — JSON.parse, a dynamic
      // import, express's req.body, Response.json() — and then type-checks against every use it
      // reaches. See the exclusion block below for the ONE place they cannot be trusted.
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      // The type-aware sonarjs rules, read one finding at a time in #1300. They had been configured
      // as errors for a long time and never ran, because nothing built a type program until this
      // block did — so what looks like a demotion below is the first time any of them was judged.
      //
      // ERROR — at zero, and each catches something real:
      "sonarjs/different-types-comparison": "error",
      "sonarjs/no-alphabetical-sort": "error",
      "sonarjs/no-misleading-array-reverse": "error",
      // ERROR here, off for `.vue` below: Vue composes emit types by intersecting call-signature
      // interfaces, which this rule reads as "a type without members".
      "sonarjs/no-useless-intersection": "error",
      // It was off on the claim that it fights no-floating-promises. It does not (#1362): S3735
      // returns early for a thenable, for `void 0`, for an IIFE, and for a call whose type is
      // any/unknown — and with no type info at all, for ANY call. So every fire-and-forget `void` in
      // server/src/common, 160-odd of them with the 66 from #1300 among those, is invisible to it.
      // Turning the rule on reported THREE, all `void map.delete(…)` squeezing a statement into an
      // arrow's `: void` body and none of them a promise; those are block bodies now.
      "sonarjs/void-use": "error",
      //
      // ERROR, with the three files that hold the deliberate uses listed further down. It was a
      // warning because "the findings are external APIs we use on purpose, so this cannot reach
      // zero" — but that reasoning applies to those three files, not to the rule, and as a warning
      // it could not tell a fourth file from the three. The five deliberate ones: `Server` from the
      // MCP SDK (x3), whose own notice says to keep using it for the low-level `setRequestHandler`
      // API we are on; `document.execCommand("copy")`, the synchronous copy that works on an
      // existing selection where the async Clipboard API does not; and `e.returnValue`, which
      // legacy Chrome/Edge still require to raise the beforeunload prompt.
      "sonarjs/deprecation": "error",
      //
      // OFF — every finding was a false positive, and the reason is structural rather than
      // incidental, so the rule will keep producing them:
      //
      // Flags a function whose returns differ in type — but all three findings DECLARED a union
      // return type (`"tool" | { said } | null`, `JsonValue`, `HeaderChip | null`). The union is
      // the contract; collapsing it would mean boxing every answer to satisfy the rule.
      "sonarjs/function-return-type": "off",
      // Wants an initial value on `reduce()`. Both findings are provably non-empty — one guards
      // `length === 0` on the line above, the other reduces `[head, ...rest]` — and the rule cannot
      // see either. An initial value there would be dead code that also changes the result type.
      "sonarjs/reduce-initial-value": "off",
      // Wants two functions instead of a boolean parameter. Its one finding takes `secret` from a
      // caller that COMPUTES it (`Object.keys(env).length > 0`), so splitting the function just
      // moves the same branch to the call site.
      "sonarjs/no-selector-parameter": "off",
    },
  },
  {
    // The same two rules for .vue. RULES ONLY — no `languageOptions` here on purpose: setting
    // `parser` would replace vue-eslint-parser and every SFC would fail to parse ("'>' expected").
    // The type program for these comes from the `**/*.vue` block above, which passes
    // `project` + `extraFileExtensions` THROUGH vue-eslint-parser to tseslint.parser.
    files: ["src/**/*.vue"],
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // OFF here, error everywhere else (#1300). The rule calls an interface holding nothing but
      // CALL signatures "a type without members", so `GridCellEmits & { (e: "session", id): void }`
      // reads as a useless intersection. That composition is how Vue's type-based `defineEmits<>`
      // reuses a child's contract, and dropping it would drop the child's events — all four
      // findings were that, and every one of them was in a `.vue`.
      "sonarjs/no-useless-intersection": "off",
    },
  },
  {
    // The `any` family is OFF wherever a `.vue` component type is in play, and that is a LIMIT OF
    // THE LINTER rather than a hole in the code.
    //
    // This exclusion is the `any` family ONLY. It is not a general "linter cannot see `.vue`":
    // the assertion bans DO cover SFCs, script side through consistent-type-assertions and
    // template side through the `vue/no-restricted-syntax` selectors (#1339).
    //
    // ESLint's type program does not generate SFC component types, so `InstanceType<typeof
    // SomeComponent>` — and any type imported from a `.vue` — resolves to the error type. Every
    // read through such a value is then reported as unsafe. `vue-tsc` resolves them fully: calling
    // a made-up method through one of these refs is rejected with the whole instance type, so this
    // code IS type-checked, just not by this pass (measured on #1300: 58 reports, 0 fixable).
    //
    // The `.ts` files listed here are the ones that import a type or component FROM a `.vue`; they
    // inherit the same blind spot. A new file that does the same belongs on this list — with the
    // import named, so the entry can be deleted if the type program ever learns SFCs.
    files: [
      "**/*.vue",
      "src/main.ts", // App.vue
      "src/plugins-registry.ts", // CollectionCardView.vue
      "src/composables/collectionUi.ts", // PinToggle.vue
    ],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // Type-assertion allowlist. Every entry is a place where NO amount of local typing can
    // express the truth, because the type that is wrong belongs to someone else. Each says which
    // upstream and what would remove it — delete the entry when that lands.
    //
    // Nothing here is "we could not be bothered": a host-side fix was written and merged for the
    // one case that had one (mulmoclaude#2721 widened `modalTeleportTarget`, and the assertion it
    // forced is gone from this repo as of collection-plugin 1.2.3).
    files: [
      // @modelcontextprotocol/sdk declares `class StreamableHTTPServerTransport implements
      // Transport` while typing that class's onclose/onerror/onmessage accessors `T | undefined`
      // where Transport spells them `?: T`. Under exactOptionalPropertyTypes the class therefore
      // fails the interface it claims to implement. Upstream issue (open, and it names this exact
      // workaround): https://github.com/modelcontextprotocol/typescript-sdk/issues/2083
      "server/routes/mcp-routes.ts",
      // gui-chat-protocol declares `dispatch<T = unknown>(args): Promise<T>` and
      // `subscribe<T>(name, handler: (payload: T) => void)`. The PLUGIN chooses T and the HOST has
      // to produce it from an untyped response / channel frame — unverifiable by construction, so
      // any implementation asserts. (The same shape in OUR OWN generics — wikiApi's getJson,
      // useSessionFeed, postConfigField — was fixed by taking a reader from the caller; that is
      // not open here, because changing the protocol's signatures breaks every plugin that
      // annotates its handler.) Moving the assertion onto the payload (`handler(data as T)`)
      // relocates it rather than removing it, so it stays where the unprovable claim is made.
      "src/composables/pluginRuntime.ts",
      // The same shape one layer out: @mulmoclaude/accounting-plugin declares
      // `AccountingApiCall = <T = unknown>(path, opts) => Promise<ApiResult<T>>`, and the
      // collection package's CollectionApiResult<T> seam matches it. The PLUGIN picks T; the host
      // can only hand it a body nothing has checked. `fetchJson` itself now REQUIRES a reader
      // (#1300), so every caller that can check does — these two cannot, and say so at the seam
      // with a one-line `asDeclared` rather than pushing the hole back into fetchJson for all of
      // them. Removing these needs the packages to take a reader, as gui-chat-protocol's own
      // `fetchJson<T>` already does: receptron/gui-chat-protocol#30.
      "src/composables/accountingUi.ts",
      "src/composables/collectionUi.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    // Tests may build values the types forbid on purpose: a malformed payload to prove the
    // parser rejects it, a partial stub standing in for a big interface. Asserting there is
    // the point of the test, not a hole in the app.
    files: ["**/*.spec.{ts,tsx,js}", "**/*.test.{ts,tsx,js}", "test/**/*.{ts,tsx,js}"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    // Test files. Only ONE guard comes off here, and it comes off because it cannot be satisfied
    // rather than because it is inconvenient: the outermost `describe(…)` callback holds the entire
    // file, so `max-lines-per-function` measures the file and no limit short of the file's length
    // can pass. Raising the number would not help — it is the wrong shape, not the wrong size. The
    // per-FILE guard is what covers specs instead, and it is an error here like everywhere else.
    //
    // `max-nested-callbacks` used to come off with it, on the same sentence about a suite being one
    // big nested callback. That one was never measured: a suite is `describe > it > callback`, which
    // is three, and the limit is four. Turning it back on across 702 specs cost three violations in
    // two files, both fixed by hoisting a fixture to the top of its file (#1688).
    files: ["**/*.spec.{ts,js}", "**/*.test.{ts,js}"],
    rules: {
      "max-lines-per-function": "off",
      // The FILE limit applies here at full strength. It was a warning, on the reasoning that
      // splitting a spec moves assertions away from each other — true, and the reason the
      // files already over it are listed below rather than split. But a warning let SEVEN
      // specs cross the line, the worst at 2264, because nothing ever failed. The list below
      // holds those seven; a spec written tomorrow gets the same 600 as everything else.
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      // Same reasoning for components: a spec defines throwaway stubs next to the case that
      // uses them (useCaptureKeydown, useNewTerminal). Splitting one-line stubs into their own
      // files would put the fixture further from the assertion, which is the opposite of what
      // the rule is for — it exists to keep SHIPPED components findable.
      "vue/one-component-per-file": "off",
    },
  },
  {
    // The files that already exceed max-lines, listed here rather than silenced with
    // eslint-disable comments so the debt is countable in one place (CLAUDE.md forbids the
    // comments, and rightly — they hide at the scene). Delete an entry once its file is under
    // the limit; the rule then holds it there.
    files: [
      "src/components/TerminalCell.vue", // 1078 — the launch form is out (#1122); the running cell's chrome (header chips, diff panel, close confirm, handoff menu) is what's left
      "src/components/TerminalGrid.vue", //  815 — layout state machine + its documented <style> exception (#1125)
      // The specs that were already over the limit when it stopped being a warning. Splitting one
      // moves assertions away from each other, so these are carried as debt rather than cut up —
      // but they are the WHOLE debt, and the rule holds every other spec at 600.
      "test/server/backends/collections.spec.ts", //  875
      "test/server/config/app-config.spec.ts", //  648
      "test/src/components/CellLaunchForm.spec.ts", //  902
      "test/src/components/GridView.spec.ts", //  785
      "test/src/components/TerminalCell.spec.ts", // 2264
      "test/src/components/TerminalGrid.spec.ts", //  767
      "test/src/components/gridTabs.spec.ts", //  921
    ],
    rules: {
      "max-lines": "off",
    },
  },
  {
    // eslint-plugin-security tuning (mirrors mulmoclaude): these three rules fire
    // on safe, intentional patterns here — workspace-relative fs paths (session
    // files keyed by validated UUIDs), dynamic `obj[key]` lookups, and regexps —
    // so they're high-noise, low-signal. The rest of `recommended` stays on.
    rules: {
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-regexp": "off",
      // `recommended` ships every rule at warn. This one is at zero and is worth keeping there:
      // a quantifier inside a quantifier is a shape, not a judgement call, and the fix is always
      // to say the rule a different way (gitlabHosts tests per label instead of per hostname).
      "security/detect-unsafe-regex": "error",
    },
  },
  {
    // `sonarjs/post-message` requires every `message` listener to compare `event.origin`, and on
    // this one such a comparison would verify nobody. The preview frame is `sandbox="allow-scripts"`
    // with no `allow-same-origin`, so its document has an opaque origin: every message it sends
    // arrives with `origin === "null"`, and so does one from any other opaque-origin document.
    // `event.source` is the sending window itself, which only that frame can be, and the listener
    // checks it — but the rule recognises `event.origin` / `event.originalEvent.origin` and nothing
    // else, so it cannot see the stronger check. It reported nothing here until the rule began
    // resolving a listener passed as an identifier rather than only an inline function.
    //
    // The exception is per FILE, and this file holds the listener and nothing else — lifted out of
    // SharedAppPreview.vue for exactly the reason the `sonarjs/deprecation` list below gives.
    files: ["src/utils/sharedAppPreviewChannel.ts"],
    rules: {
      "sonarjs/post-message": "off",
    },
  },
  {
    // The deliberate uses of a deprecated external API, listed here rather than silenced at the
    // scene, for the reason the max-lines list above gives: countable in one place, and deleting an
    // entry re-arms the rule for that file. Each one is explained where it is used.
    //
    // The exception is per FILE, so each entry has to be a file where the deprecated API is the
    // SUBJECT — otherwise it also covers the next one added there by accident. That is why
    // `writeTerminalSelection` was lifted out of useTerminalConnections.ts (several hundred lines,
    // one deprecated call) into a file of its own. The other two are already that shape: broker.ts
    // is the MCP server, and useUnloadGuard.ts is the beforeunload handler.
    files: ["server/mcp/broker.ts", "src/utils/terminalSelectionClipboard.ts", "src/composables/useUnloadGuard.ts"],
    rules: {
      "sonarjs/deprecation": "off",
    },
  },
  prettierRecommended,
];
