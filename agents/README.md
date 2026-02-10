# Sub-Agent System

This directory contains the built-in sub-agents for Octofriend. Sub-agents are specialized AI agents that can be delegated tasks via the `task` tool.

## Overview

Sub-agents allow Octo to:

- **Parallelize work** - Run multiple independent tasks concurrently
- **Specialize** - Use read-only agents for exploration, full-access agents for implementation
- **Isolate context** - Keep exploration results out of the main conversation

## Creating a New Agent

To create a sub-agent, add a new directory with an `AGENT.md` file:

```
agents/
  your-agent-name/
    AGENT.md
```

### AGENT.md Format

Each `AGENT.md` file has two parts: YAML frontmatter and a system prompt.

```yaml
---
name: your-agent-name
description: "A brief description of what this agent does"
model: inherit
tools:
  - read
  - list
  - shell
disallowedTools:
  - edit
  - write
---
You are a specialized agent for... (system prompt content)
```

### Frontmatter Fields

| Field             | Required | Description                                                                               |
| ----------------- | -------- | ----------------------------------------------------------------------------------------- |
| `name`            | **Yes**  | Must match the directory name. Alphanumeric with hyphens. Max 64 chars.                   |
| `description`     | **Yes**  | Shown in tool descriptions. Max 1024 chars.                                               |
| `model`           | No       | Model to use. `inherit` (default) uses parent's model, or specify a nickname from config. |
| `tools`           | No       | Array of tool names to allow. Empty array = no tools. Omit = all tools.                   |
| `disallowedTools` | No       | Array of tool names to explicitly deny. Applied after `tools` filter.                     |
| `permissionMode`  | No       | One of: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`                  |
| `skills`          | No       | Array of skill names to auto-load                                                         |
| `hooks`           | No       | Object with hook configurations                                                           |

### Agent Types

**Read-only agents** (exploration, research):

```yaml
tools: [read, list, shell, grep, glob, fetch]
disallowedTools: [edit, create, append, prepend, rewrite]
```

**Full-access agents** (implementation, complex tasks):

```yaml
# Omit tools to allow all, or specify exactly what you need
tools: []
```

## Agent Discovery

Agents are loaded from multiple sources (in order):

1. **Built-in agents** - This `agents/` directory in the project
2. **User agents** - `~/.config/agents/agents/` (global user agents)
3. **Project agents** - `.agents/agents/` (relative to working directory)
4. **Custom paths** - Configured in `octofriend.json5` under `agents.paths`

Agents with duplicate names are deduplicated (first wins).

## Model Selection Hierarchy

When a sub-agent runs, the model is selected in this priority order:

1. **Runtime override** - `model` parameter passed to the `task` tool call
2. **Agent static** - `model` field in the agent's frontmatter (if not `inherit`)
3. **Config default** - `defaultSubAgentModel` in `octofriend.json5`
4. **Parent model** - The model the main agent is currently using

## Best Practices

### When to Create a Sub-Agent

Create a sub-agent when you need to:

- Explore multiple areas of code in parallel
- Delegate a specialized task (security audit, performance analysis)
- Keep large exploration results out of main context
- Run independent tasks concurrently

### Read-Only vs Full-Access

| Use Case               | Pattern     | Example                 |
| ---------------------- | ----------- | ----------------------- |
| Code exploration       | Read-only   | `explore` agent         |
| Pre-planning research  | Read-only   | `plan` agent            |
| Complex implementation | Full-access | `general-purpose` agent |
| Security auditing      | Read-only   | Custom security agent   |

### System Prompt Guidelines

1. **Be specific** - Clearly define the agent's role and responsibilities
2. **Include output format** - Tell the agent how to structure results
3. **Set boundaries** - Explicitly state limitations (read-only, no sub-agents)
4. **Add examples** - Show the agent what good output looks like

### Tool Selection

- **Minimal principle** - Only give tools the agent actually needs
- **Read-only safety** - Use `disallowedTools` to prevent edits for exploration agents
- **No sub-agent recursion** - Sub-agents cannot spawn other sub-agents

## Testing Your Agent

1. **Validate the format**:

   ```bash
   npm test -- agent-parser
   ```

2. **Test discovery** - Start Octo and check if your agent appears in the `task` tool description

3. **Test execution** - Delegate a task to your agent:
   ```
   @octo Use the task tool to delegate "analyze the codebase structure" to your-agent-name
   ```

## Example: Creating a Security Audit Agent

```yaml
---
name: security-audit
description: "Analyzes code for security vulnerabilities. Read-only - does not make changes."
model: inherit
tools:
  - read
  - list
  - shell
  - grep
  - glob
disallowedTools:
  - edit
  - create
  - write
  - append
  - prepend
---
You are a security-focused code auditor. Analyze code for:
  - SQL injection vulnerabilities
  - XSS risks
  - Unsafe deserialization
  - Hardcoded secrets
  - Insecure dependencies

## Output Format

Provide findings as:
```

## Summary

Brief overview of security posture

## Critical Issues

- File:line - Issue description

## Warnings

- File:line - Warning description

## Recommendations

Suggested fixes or next steps

```

## Guidelines
- Always cite specific file paths and line numbers
- Rate issues by severity (Critical/High/Medium/Low)
- Focus on exploitable vulnerabilities, not style issues
- Do not make any changes to files
```

## Reference: Built-in Agents

| Agent             | Purpose                   | Tools                                | Pattern     |
| ----------------- | ------------------------- | ------------------------------------ | ----------- |
| `explore`         | Fast codebase exploration | read, list, shell, grep, glob, fetch | Read-only   |
| `plan`            | Research for planning     | read, list, shell, grep, glob, fetch | Read-only   |
| `general-purpose` | Complex multi-step tasks  | All                                  | Full-access |
