# Contributing to Octofriend

Thank you for your interest in contributing to Octofriend! We welcome contributions in many forms: code, bug reports, and documentation improvements. Before diving in, please take a moment to read through these guidelines so we can keep the project healthy and the review process smooth for everyone.

## Table of Contents

- [Before You Start](#before-you-start)
- [Development Setup](#development-setup)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Code Style](#code-style)
- [Reporting Bugs](#reporting-bugs)
- [A Note on AI-Assisted Code](#a-note-on-ai-assisted-code)

---

## Before You Start

- Check existing [issues](https://github.com/synthetic-lab/octofriend/issues) and [pull requests](https://github.com/synthetic-lab/octofriend/pulls) to avoid duplicating work.
- For new features, discuss your approach in a [#feature-request](https://discord.com/channels/1315627714056687706/1476772316401893407) post in our [Discord](https://synthetic.new/discord) or in a Github issue. We may have opinions on the direction, and it's better to align early than after you've put in the work.
- If you want to work on an open issue or feature, comment on it (either on Discord or GH Issues) to let others know.

---

## Development Setup

**Getting started:**

```bash
# Fork the repo on GitHub, then clone your fork:
git clone https://github.com/your-username/octofriend.git
cd octofriend

# Install dependencies:
npm install

# Build & run the project:
npm run exec
```

**Canary builds:**

If you ever want to run your local checkout directly instead of a published release, source `canary.sh` in your shell config:

```bash
# Add this to your ~/.zshrc or ~/.bashrc:
source /path/to/octofriend/canary.sh
```

This defines a `canary-octo` command that builds your current checkout and runs it on the spot. Useful for testing your changes without a full publish cycle:

```bash
canary-octo
```

---

## Submitting Pull Requests

1. **Keep PRs focused.** One fix or feature per PR. Large, sprawling PRs are hard to review and more likely to be closed.
2. **Write a clear description.** Explain what the change does and why. Link to any related issues using `fixes #123` or `closes #123`.
3. **Make sure the build passes.** Run `npm run build` before submitting.
4. **Run tests.** Run `npm run test:run` and make sure nothing is broken.
5. **Format your code.** Run `npm run format` before pushing.
6. **Screenshots.** If your PR changes something visible (UI layout, terminal output, formatting, error messages, or any user-facing behavior), please include screenshots or terminal recordings in the PR description.
7. **Run your PR through an AI code-review agent** Code-review agents help catch any obvious bugs or nits, requiring less back-and-forth for everyone!
8. **Mark drafts as drafts.** If your PR isn't ready for review, open it as a Draft.

### When we may close your PR

We put a lot of care into keeping the codebase coherent. We may close a PR without merging if:

- It requires extensive back-and-forth to get into shape and it doesn't feel like it's converging.
- The code introduces unnecessary complexity without clear benefit.
- The change doesn't align with the project's direction.
- It looks like entirely vibecoded output (more on that below).

We'll always try to explain our reasoning, and a closed PR doesn't mean "never". If you want to revisit the direction, open an issue first and let's talk it through.

### Review times

We're a small team. We do our best to review PRs promptly, but please give us some grace if it takes a little while to get to yours. If your PR has been sitting for a couple of weeks with no response, feel free to leave a polite comment and we'll pick it up.

---

## Code Style

- Prettier handles formatting automatically. Just run `npm run format`.
- Prefer `type Blah = { ... }` over `interface Blah { ... }` unless you specifically need an interface (i.e., it's designed for classes to implement).
- Keep things simple. Don't add abstractions, helpers, or generalization for hypothetical future needs.
- Remove redundant comments that restate what the code already says. If your AI assistant added them, delete them before submitting. For example, delete these kinds of comments:

```ts
// Increments the counter by one
counter++;
```

---

## Reporting Bugs

A good bug report makes it much easier to reproduce and fix the issue. Please include:

- **What you expected to happen**
- **What actually happened**
- **Steps to reproduce**: as minimal and specific as possible. For request errors, use Copy request as cURL to give us more information.
- **Your environment**: OS, terminal, LLM provider/model, etc.
- **Relevant logs**: run with `OCTO_VERBOSE=1 octofriend` to get more detailed output
- **Screenshots or recordings**: especially if the issue is visual or involves terminal rendering

Please search existing issues before opening a new one.

---

## A Note on AI-Assisted Code

Yes, we know: we're an AI company asking you to think before using AI coding agents. The irony is not lost on us. We genuinely love AI-assisted development (it's literally what we're building) and we use it ourselves. But there is a meaningful difference between AI as a tool and AI as a replacement for thinking, and that difference will show in the code-quality.

**We encourage:** Using AI to help you write, refactor, debug, or understand code, while staying in the driver's seat. The code you submit should reflect your understanding of the problem and the codebase. It's also great for generating complicated testing data.

**We discourage:** "Vibecoding": generating large blocks of code with an AI, skimming the output, and submitting it with minimal review or understanding. We can usually tell. Code like this tends to:

- Introduce patterns inconsistent with the rest of the codebase
- Add unnecessary abstractions, error handling, or boilerplate
- Miss the actual intent of the change
- Be hard to maintain because the author doesn't fully understand it

If you submit a PR that looks vibecoded, we may close it. This isn't about gatekeeping AI use. It's about maintaining a codebase that's coherent, intentional, and actually works. If you used AI to help write your PR, great. Just make sure you understand every line of it and that it fits naturally into the project.

---

Thank you for contributing. Now go build something cool with Octo! 🐙
