import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "coverage/",
      "training/repos/",
      "scripts/dev/",
      ".agents/",
      ".claude/",
      ".octofriend/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // All child processes must go through OctoProcess (source/octo-process.ts)
      // so they're tracked and killed when Octo exits.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "child_process",
              message:
                "Import from `source/octo-process.ts` instead: OctoProcess manages the process lifecycle for you.",
            },
            {
              name: "node:child_process",
              message:
                "Import from `source/octo-process.ts` instead: OctoProcess manages the process lifecycle for you.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value='child_process']",
          message:
            "Import from `source/octo-process.ts` instead: OctoProcess manages the process lifecycle for you.",
        },
        {
          selector: "ImportExpression[source.value='node:child_process']",
          message:
            "Import from `source/octo-process.ts` instead: OctoProcess manages the process lifecycle for you.",
        },
      ],

      // `any`, `@ts-ignore`, and `{}` (used as a sentinel/placeholder type in
      // the libocto IR) are used deliberately across the codebase; turning
      // these on would be a huge rollout and belong to their own PR.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",

      // Empty catch blocks are used deliberately for best-effort cleanup.
      "no-empty": ["error", { allowEmptyCatch: true }],

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // The only module allowed to touch `child_process` directly.
    files: ["source/octo-process.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    // Training data tooling runs standalone, outside the Octo process.
    files: ["training/**"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    // Type-level compile tests intentionally use @ts-expect-error, and probe
    // types with expression statements and symbols that are only exercised by
    // the typechecker.
    files: ["**/*.compiletest.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
);
