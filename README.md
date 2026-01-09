Octo is a small, helpful, zero-telemetry, cephalopod-flavored coding assistant.
Octo is your friend.

## Get Started

```bash
npm install --global octofriend
```

And then:

```bash
octofriend
# or, for short:
octo
```

![octofriend](https://raw.githubusercontent.com/synthetic-lab/octofriend/main/octofriend.png)

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

Octo works great with GLM-4.7, GPT-5.2, Claude 4.5, and Kimi K2 Thinking
(although you can use it with pretty much anything!). Correctly handling
multi-turn responses, especially with thinking models like GPT-5 and Claude
(whose content may even be encrypted), can be tricky. Octo carefully manages
thinking tokens to ensure it's always as smart as it can be. We think it's the
best multi-LLM tool out there at managing thinking tokens, and you'll feel how
much smarter it is.

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

## Sandboxing Octo

Octo has built-in Docker support, and can attach to any Docker container
without needing special configuration or editing the image or container. To
make Octo run inside an *existing* container you have running — for example, if
you already have a Docker Compose setup — run `octo docker connect
your-container-name`.

To have Octo launch a Docker image and shut it down when Octo quits, you can
run:

```bash
# Make sure to add the -- before the docker run args!
octo docker run -- ordinary-docker-run-args
```

For example, to launch Octo inside an Alpine Linux container:

```bash
octo docker run -- -d -i -t alpine /bin/sh
```

All of Octo shell commands and filesystem edits and reads will happen inside
the container. However, Octo will continue to use any MCP servers you have
defined in your config via your host machine (since the MCP servers are
presumably running on your machine, not inside the container), and will make
HTTP requests from your machine as well if it uses the built-in `fetch` tool,
so that you can use arbitrary containers that may not have `wget` or `curl`
installed.

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

## Skills

Octo supports the [Agent Skills](https://agentskills.io/) spec for giving
reusable context-dependent instructions. If you want to give special
instructions for Octo to do code reviews, for example, you might write a code
review skill file, and Octo will intelligently load the skill when it needs to
do code reviews. You can find the full skill spec on the [Agent Skills
website](https://agentskills.io), but they're essentially just tagged Markdown
with optional scripts. Here's a very simple code review skill you might use:

```markdown
---
name: "pr-review"
description: "Review Github pull requests"
---
To load a Github pull request, run the fetch tool twice:


## First fetch
First, load the URL for the PR to understand the author's intent.

Your fetch tool does not execute JavaScript. Note that parts of the Github UI
may fail without JS; for example, loading comments might say:

    UH OH!
    There was an error while loading"

This is okay and expected. Don't worry about that.

## Second fetch: load the diff
To load the diff for the PR, fetch the PR URL with a `.diff`
attached to the end. For example, to review
`https://github.com/synthetic-lab/octofriend/pull/66`, you should fetch:

`https://github.com/synthetic-lab/octofriend/pull/66.diff`

The diff is the most important part. The author may be incorrect, or have the
right idea but the wrong implementation. Focus on whether there are any bugs or
unexpected behavior.
```

We automatically detect skills in the following places:

* `~/.config/agents/skills`, for global skill definitions
* `.agents/skills`, for skills relative to the current directory Octo is
  working in. For example, if your company has special guidelines for agents,
  you can distribute them with your company's repo in an `.agents/skills`
  directory.

If there are more directories you want Octo to discover skills from, you can
add them to your `~/.config/octofriend/octofriend.json5` config file like so:


```javascript
skills: {
  paths: [
    // a list of directory paths containing skills
  ],
},
```

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
    args: [
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
    args: [ "-y", "mcp-remote", "https://mcp.linear.app/sse" ],
  },
},
```

## Using Octo with local LLMs

If you're a relatively advanced user, you might want to use Octo with local
LLMs. Assuming you already have a local LLM API server set up like ollama or
llama.cpp, using Octo with it is super easy. When adding a model, make sure to
select `Add a custom model...`. Then it'll prompt you for your API base URL,
which is probably something like: `http://localhost:3000`, or whatever port
you're running your local LLM server on. After that it'll prompt you for an
environment variable to use as a credential; just use any non-empty environment
variable and it should work (since most local LLM server ignore credentials
anyway).

You can also edit the Octofriend config directly in
`~/.config/octofriend/octofriend.json5`. Just add the following to your list of
models:

```json5
{
  nickname: "The string to show in the UI for your model name",
  baseUrl: "http://localhost:SOME_PORT",
  apiEnvVar: "any non-empty env var",
  model: "The model string used by the API server, e.g. openai/gpt-oss-20b",
}
```

## Debugging

By default, Octo tries to present a pretty clean UI. If you want to see
underlying error messages from APIs or tool calls, run Octo with the
`OCTO_VERBOSE` environment variable set to any truthy string; for example:

```bash
OCTO_VERBOSE=1 octofriend
```
