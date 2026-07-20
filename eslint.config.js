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
    },
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
