![octofriend](./octofriend.png)

Octo is a small, helpful, cephalopod-flavored coding assistant that works with
any OpenAI-compatible LLM API, with a few neat tricks for managing context
space. Octo wants to help you because Octo is your friend.

Octo has zero telemetry. Using it with a local LLM or privacy-focused inference
provider ([may we selfishly recommend Synthetic?](https://synthetic.new)) means
your code stays yours, and not someone else's training data. Or, you can use
Octo with any of the major inference companies: OpenAI, Grok, Mistral,
Moonshot, etc. Octo works great with DeepSeek-R1-0528, Kimi K2, Grok 4, and
many other modern coding LLMs.

Octo tries to be a complete product: unlike some other open-source tools, we
iterate on context engineering strategies in addition to UI, in an attempt to
squeeze the best performance out of coding LLMs.

Octo has helped write some of its own source code, but we're human-first: Octo
is meant to be a friendly little helper rather than a completely hands-free
author, and that's how we use it. We don't blindly commit LLM-generated code,
and typically iterate extensively with any code Octo writes.

# Install Octo
```bash
$ npm install --global octofriend
# Then:
octofriend
```

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

Although Octo can do a lot out of the box — pretty much anything is possible
with enough Bash — but if you want access to rich data from an MCP server, it'll
help Octo out a lot to just provide the MCP server directly instead of trying
to contort its tentacles into crafting the right Bash-isms. After you run
`octofriend` for the first time, you'll end up with a config file in
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
