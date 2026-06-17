import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import sonarjs from "eslint-plugin-sonarjs";

export default [
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...pluginVue.configs["flat/recommended"],
  sonarjs.configs.recommended,
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        HTMLDivElement: "readonly",
        WebSocket: "readonly",
        ResizeObserver: "readonly",
        MouseEvent: "readonly",
        KeyboardEvent: "readonly",
        window: "readonly",
        document: "readonly",
        location: "readonly",
        localStorage: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
    },
  },
  {
    files: ["server/**/*.js"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
];
