// ESLint flat config.
// - src/*.js  : browser script (loaded via <script>), classic script scope.
// - scripts/*.mjs + this config : Node ES modules.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**"] },

  js.configs.recommended,

  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: { ...globals.browser },
    },
    rules: {
      "no-debugger": "error",
      "no-console": "warn",
    },
  },

  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-debugger": "error",
      // scripts are CLI tools: printing to the console is their job.
      "no-console": "off",
    },
  },
];
