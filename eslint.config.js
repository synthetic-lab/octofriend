import tseslint from "typescript-eslint";

// ESLint runs in WHITELIST mode: no `recommended` config presets are used.
// Only the rules explicitly listed below are enforced, so upgrading ESLint or
// typescript-eslint can never silently enable new rules. If you want a new
// rule, add it here deliberately.
//
// Deliberately NOT enabled (ruled against in review):
// - no-control-regex: control characters in regexes are useful (e.g. ANSI).
// - no-case-declarations: Prettier's indentation makes case scoping clear.
// - no-unexpected-multiline: redundant with Prettier, which normalizes
//   semicolons and line breaks so multi-line expression hazards stand out.
// - no-extra-boolean-cast, no-useless-catch, prefer-spread, no-this-alias:
//   style-only simplifications with no bug-catching value.
// - no-namespace, prefer-namespace-keyword, triple-slash-reference: guards
//   against legacy TS constructs nobody writes by accident.
// - no-useless-assignment: flags deliberate null-initialization in the
//   "assign in each if/else branch" pattern, which pressures rewrites into
//   ternaries — bad trade for multi-line or await-heavy branches.
// - preserve-caught-error: not worth the churn; interpolating the caught
//   error's message into rethrown errors is considered good enough here.
// - @typescript-eslint/no-inferrable-types, prefer-as-const: explicit type
//   annotations on initializers are allowed for readability.
// - @typescript-eslint/no-explicit-any, ban-ts-comment, no-empty-object-type:
//   `any`, `@ts-ignore`, and `{}` are used deliberately across the codebase.

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
  {
    // Core ESLint rules, applied to all linted files.
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

      // Empty catch blocks are used deliberately for best-effort cleanup.
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Counters moving the wrong way = infinite loops.
      "for-direction": "error",
      // Async Promise executors swallow errors and race.
      "no-async-promise-executor": "error",
      // `x === -0` doesn't behave like you'd expect.
      "no-compare-neg-zero": "error",
      // Catches `=` typos for `==` in conditions.
      "no-cond-assign": ["error", "except-parens"],
      // Expressions that can never vary are almost always logic bugs.
      "no-constant-binary-expression": "error",
      // Constant conditions mean dead branches.
      "no-constant-condition": ["error", { checkLoops: "allExceptWhileTrue" }],
      // Stray debugger halts shouldn't ship.
      "no-debugger": "error",
      // `delete` on a variable is a strict-mode crash.
      "no-delete-var": "error",
      // Duplicated else-if conditions are dead code.
      "no-dupe-else-if": "error",
      // Duplicate switch cases are unreachable.
      "no-duplicate-case": "error",
      // `/[]/` never matches anything.
      "no-empty-character-class": "error",
      // Empty destructuring does nothing; usually a typo.
      "no-empty-pattern": "error",
      // Empty static blocks signal forgotten init code.
      "no-empty-static-block": "error",
      // Rebinding the caught error loses it.
      "no-ex-assign": "error",
      // Missing `break` between cases falls through silently.
      "no-fallthrough": "error",
      // Reassigning globals breaks the runtime.
      "no-global-assign": "error",
      // Catches invalid RegExp() patterns at lint time.
      "no-invalid-regexp": "error",
      // Catches invisible chars Prettier misses (strings/comments/regexes).
      "no-irregular-whitespace": "error",
      // Number literals that silently round to a different value.
      "no-loss-of-precision": "error",
      // Character classes that match only half an astral character.
      "no-misleading-character-class": "error",
      // `\8`/`\9` escapes don't do what they look like.
      "no-nonoctal-decimal-escape": "error",
      // Leading zeros silently change the number (0755 !== 755).
      "no-octal": "error",
      // `obj.hasOwnProperty()` blows up on null-prototype objects.
      "no-prototype-builtins": "error",
      // Double spaces in regexes are invisible typos.
      "no-regex-spaces": "error",
      // `x = x` is always a typo.
      "no-self-assign": "error",
      // Rebinding undefined/NaN/etc. breaks everything downstream.
      "no-shadow-restricted-names": "error",
      // Array holes behave differently from explicit `undefined`.
      "no-sparse-arrays": "error",
      // Reading never-assigned vars always yields undefined.
      "no-unassigned-vars": "error",
      // Control flow in `finally` silently swallows errors and returns.
      "no-unsafe-finally": "error",
      // `?.` used in positions that then always throw.
      "no-unsafe-optional-chaining": "error",
      // Labels nobody jumps to are leftover mistakes.
      "no-unused-labels": "error",
      // Unread #private members signal dead code/typos.
      "no-unused-private-class-members": "error",
      // Backrefs to not-yet-closed groups always match empty.
      "no-useless-backreference": "error",
      // Escapes that do nothing mislead about intent; often typos.
      "no-useless-escape": "error",
      // Prevents the hoisting/redeclaration bug class wholesale.
      "no-var": "error",
      // A `let` that's never reassigned often means the update was forgotten.
      "prefer-const": "error",
      // `arguments` silently binds the outer scope inside arrow functions.
      "prefer-rest-params": "error",
      // A `function*` with no `yield` is a typo.
      "require-yield": "error",
      // `x === NaN` is always false.
      "use-isnan": "error",
      // Catches typos in typeof comparisons ("strnig").
      "valid-typeof": "error",
    },
  },
  {
    // TypeScript: parser + plugin, with only the listed rules enabled.
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // `new Array(3)` (length) vs `Array(1, 2)` (items) ambiguity.
      "@typescript-eslint/no-array-constructor": "error",
      // Duplicate enum values are copy-paste bugs.
      "@typescript-eslint/no-duplicate-enum-values": "error",
      // `foo!!` is a typo that reads as valid code.
      "@typescript-eslint/no-extra-non-null-assertion": "error",
      // Bogus `new` signatures on interfaces primitives can't satisfy.
      "@typescript-eslint/no-misused-new": "error",
      // `foo?.bar!` contradicts itself: still throws on undefined.
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      // `require()` breaks an ESM codebase's module assumptions.
      "@typescript-eslint/no-require-imports": "error",
      // `T extends any` disables the very checking it pretends to add.
      "@typescript-eslint/no-unnecessary-type-constraint": "error",
      // Class/interface merges that hide real member conflicts.
      "@typescript-eslint/no-unsafe-declaration-merging": "error",
      // The `Function` type accepts any call, zero type safety.
      "@typescript-eslint/no-unsafe-function-type": "error",
      // Statements with no effect are usually mistyped calls.
      "@typescript-eslint/no-unused-expressions": "error",
      // `String`/`Boolean` object types don't match primitives.
      "@typescript-eslint/no-wrapper-object-types": "error",

      // Dead vars/imports usually signal typos or missed wiring.
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
