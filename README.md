![octofriend](https://raw.githubusercontent.com/synthetic-lab/octofriend/main/octofriend.png)

## Get Started

```bash
npm install --global octofriend
```

And then:

```bash
octofriend
```

## About

Octo is a small, helpful, cephalopod-flavored coding assistant that works with
any OpenAI-compatible or Anthropic-compatible LLM API, and allows you to switch
models at will mid-conversation when a particular model gets stuck. Octo can
optionally use (and we recommend using) ML models we custom-trained and
open-sourced ([1](https://huggingface.co/syntheticlab/diff-apply),
[2](https://huggingface.co/syntheticlab/fix-json)) to automatically handle tool
call and code edit failures from the main coding models you're working with:
the autofix models work with any coding LLM. Octo wants to help you because
Octo is your friend.

Octo works great with Claude 4, GLM-4.5, Kimi K2, or the new open-source
open-gpt-120b model, and it allows you to swap to many different models on the
fly, mid-conversation. It also works with Grok 4, OpenAI o3, Qwen3, local LLMs,
and any OpenAI-compatible LLM API.

Correctly handling multi-turn responses, especially with reasoning models like
Claude 4 and OpenAI o3 (whose content may even be encrypted), can be tricky.
Octo carefully manages reasoning tokens to ensure it's always as smart as it
can be.

Octo has zero telemetry. Using Octo with a privacy-focused LLM provider (may we
selfishly recommend [Synthetic](https://synthetic.new)?) means your code stays
yours. But you can also use it with any OpenAI-compatible API provider, with
Anthropic, or with local LLMs you run on your own machine.

Octo has helped write some of its own source code, but the codebase is
human-first: Octo is meant to be a friendly little helper rather than a
completely hands-free author, and that's how I use it. But if you want to live
dangerously, you can always run `octofriend --unchained`, and skip all tool and
edit confirmations.

## Demo
[![Octo asciicast](https://raw.githubusercontent.com/synthetic-lab/octofriend/main/octo-asciicast.svg)](https://asciinema.org/a/728456)
## Rules

Octo will look for instruction files named like so:

- `OCTO.md`
- `CLAUDE.md`
- `AGENTS.md`

Octo uses the *first* one of those it finds: so if you want to have different
instructions for Octo than for Claude, just have an `OCTO.md` and a
`CLAUDE.md`, and Octo will ignore your `CLAUDE.md`.

Octo will search the current directory for rules, and every parent directory,
up until (inclusive of) your home directory. All rule files will be merged: so
if you want project-specific rules as well as general rules to apply
everywhere, you can add an `OCTO.md` to your project, as well as a global
`OCTO.md` in your home directory.

If you don't want to clutter your home directory, you can also add a global
rules file in `~/.config/octofriend/OCTO.md`.

## Connecting Octo to MCP servers

Octo can do a lot out of the box — pretty much anything is possible with enough
Bash — but if you want access to rich data from an MCP server, it'll help Octo
out a lot to just provide the MCP server directly instead of trying to contort
its tentacles into crafting the right Bash-isms. After you run `octofriend` for
the first time, you'll end up with a config file in
`~/.config/octofriend/octofriend.json5`. To hook Octo up to your favorite MCP
server, add the following to the config file:

```json5
mcpServers: {
  serverName: {
    command: "command-string",
    arguments: [
      "arguments",
      "to",
      "pass",
    ],
  },
},
```

For example, to plug Octo into your Linear workspace:

```json5
mcpServers: {
  linear: {
    command: "npx",
    arguments: [ "-y", "mcp-remote", "https://mcp.linear.app/sse" ],
  },
},
```
