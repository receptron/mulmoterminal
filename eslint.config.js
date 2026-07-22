import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import sonarjs from "eslint-plugin-sonarjs";
import security from "eslint-plugin-security";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...pluginVue.configs["flat/recommended"],
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
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
      "src/components/CommandCell.vue", //        overrides of the shared .cell-btn + the shared chrome imports
      "src/components/TerminalCell.vue", //       shared chrome import
      "src/components/LauncherCell.vue", //       shared chrome imports
      "src/components/ToolbarPopover.vue", //     shared popover chrome import
    ],
    rules: { "vue/no-restricted-block": "off" },
  },
  {
    files: ["server/**/*.js", "bin/**/*.js", "scripts/**/*.{js,mjs}"],
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
    // (error@15). All ERRORS (enforced going forward) except max-params, which stays WARN
    // for its one intentional offender: spawnClaudePty's 7 params (hot path, not worth
    // churning 5 call sites into an options object) — flip it to error once resolved.
    rules: {
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["warn", 6],
      "max-nested-callbacks": ["error", 4],
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
    // Test files: a describe/it suite is one big (nested) callback by design, so the
    // length + callback-nesting guards are noise here. Keep the logic-complexity guards on.
    files: ["**/*.spec.{ts,js}", "**/*.test.{ts,js}"],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
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
    },
  },
  prettierRecommended,
];
