import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

// Flat config for ESLint 9. Scope is intentionally narrow: catch the
// react-hooks footguns (rules-of-hooks, exhaustive-deps) and obvious
// unused/undefined identifiers. The project uses `any` widely on the
// API boundary, so no-explicit-any is off — that's tracked as tech debt
// elsewhere, not as a per-PR blocker.
//
// Plugin sources (`plugins/**`, the developer-side plugin tree at the repo root)
// are linted with the SAME react-hooks + browser-globals ruleset as `src/**`:
// plugins are React code that ships inside the main bundle, so a hooks violation
// there is exactly as costly as one in src/. See SSOT §2.1 的「必须同步修改的
// 工程配置」表 —— 漏掉这一条时插件内的 hooks 违规不会被 lint 拦下。
export default tseslint.config(
  {
    // `.private/**` is the NyaaChat-Private sub-repo (its own git repo, ignored
    // by .gitignore). Its content is reference material and WIP design docs —
    // not lint targets, same as `.ref/**`.
    // `dev-server/**` is the local dev-container repo (NyaaChat-dev, also
    // git-ignored): Node/nginx tooling with its own conventions, never shipped.
    //
    // `src/temp/**` and `.verify-tmp/**` are the agents' in-flight scratch
    // directories (probe scripts that are deleted before a task closes). They
    // are deliberately NOT linted: `npm run lint` is the shared acceptance gate
    // for every task, and a half-written probe sitting in one of them would
    // turn it red for everybody else. The same two paths are in .gitignore and
    // in tsconfig.json's `exclude` — all three lists must stay in sync.
    // Do NOT add `src/**` / `plugins/**` here: those are real product code and
    // the gate is only worth anything if it keeps checking them.
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/temp/**",
      ".verify-tmp/**",
      ".claude/**",
      ".ref/**",
      ".private/**",
      "dev-server/**",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "plugins/**/*.{ts,tsx}"],
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
    files: ["vite.config.ts", "eslint.config.js", "ext-host/**/*.js", "shared-server/**/*.js", "nyaachat-knowledge/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The two private sub-services are plain Node ESM; let them use the same
    // `^_` ignore convention as src/ (e.g. the `{ ok: _unused, ...clean }`
    // destructuring pattern in account.js is intentional, not dead code).
    files: ["shared-server/**/*.js", "nyaachat-knowledge/**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
