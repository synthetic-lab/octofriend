![octofriend](https://raw.githubusercontent.com/reissbaker/octofriend/main/octofriend.png)

```bash
$ npm install --global octofriend
```

Octo is a small, helpful, cephalopod-flavored coding assistant that works with
any OpenAI-compatible LLM API, and allows you to switch models at will
mid-conversation when a particular model gets stuck. Octo also has a few neat
tricks for managing context space. Octo wants to help you because Octo is your
friend.

I originally built Octo to try out coding agents with DeepSeek V3-0324; it
worked alright, but not quite as well as Claude. Kimi K2 is a significant step
up in capabilities over DeepSeek and with it, Octo feels much more in line with
Claude Code — but with the ability to swap to many different models on the fly.
Octo also works with Grok 4, OpenAI o3, local LLMs, and any OpenAI-compatible
LLM API; I typically use Kimi K2 for day-to-day tasks, and mid-conversation
swap to a strong reasoning model if Kimi is getting stuck on a harder problem.

Octo tries to be a complete product: the project iterates on context engineering
strategies in addition to UI, in an attempt to squeeze the best performance out
of coding LLMs.

Octo has helped write some of its own source code, but the codebase is
human-first: Octo is meant to be a friendly little helper rather than a
completely hands-free author, and that's how I use it. But if you want to live
dangerously, you can always run `octofriend --unchained`, and skip all tool and
edit confirmations.

Octo has zero telemetry.

## Demo
[![Octo asciicast](https://asciinema.org/a/lPs0ZKoXERpaAdbL7lQD3T4iJ.svg)](https://asciinema.org/a/lPs0ZKoXERpaAdbL7lQD3T4iJ)
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
