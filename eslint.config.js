import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

// Flat config for ESLint 9. Scope is intentionally narrow: catch the
// react-hooks footguns (rules-of-hooks, exhaustive-deps) and obvious
// unused/undefined identifiers. The project uses `any` widely on the
// API boundary, so no-explicit-any is off — that's tracked as tech debt
// elsewhere, not as a per-PR blocker.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src/temp/**", ".claude/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow `import type` to be elided automatically; not enforcing strict
      // import-type style yet.
      "@typescript-eslint/consistent-type-imports": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["vite.config.ts", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
