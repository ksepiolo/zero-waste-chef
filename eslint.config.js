/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
    // astro-eslint-parser doesn't attach a parent to frontmatter-level nodes, which crashes
    // this rule's checkReturnStatement on any top-level `return` in frontmatter.
    "@typescript-eslint/no-misused-promises": "off",
  },
});

// Plain Node scripts that ship inside a GitHub composite action. They live under a dot-directory,
// which TypeScript's `include: ["**/*"]` glob skips, so the project service cannot resolve them and
// every type-aware rule errors out. Lint them with the untyped rules instead of not at all.
const githubScriptsConfig = tseslint.config({
  files: [".github/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: {
    globals: {
      process: "readonly",
    },
  },
});

const nodeConfigFilesConfig = tseslint.config({
  files: ["*.config.{js,mjs,cjs,ts}"],
  languageOptions: {
    globals: {
      process: "readonly",
    },
  },
});

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  // `packages/*` are standalone npm projects with their own lockfiles and lint configs; the root
  // `npm ci` never installs them, so type-aware rules here would resolve every import to `error`.
  // Not a `.gitignore` line — that file is fed to the config above and would untrack the sources.
  { ignores: ["packages/**"] },
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  nodeConfigFilesConfig,
  githubScriptsConfig,
  eslintPluginPrettier,
);
