# Octofriend Codebase Map

## Top-Level Directory Structure

```
/home/zebastjan/dev/octofriend/
├── source/           # Main TypeScript/TSX source code
├── dist/             # Compiled JavaScript output (Babel + TypeScript)
├── drizzle/          # Database migrations and schema
├── scripts/          # Utility scripts
├── training/         # Training data and related files
├── package.json      # Dependencies: ai SDK, MCP SDK, Ink, React, etc.
├── tsconfig.json     # TypeScript configuration
└── babel.config.json # Babel build configuration
```

## Entry Point & CLI

**File:** `source/cli.tsx:1-582`

- **Binary:** `dist/source/cli.js` (aliased as `octofriend` and `octo`)
- **CLI Framework:** Commander.js with extra typings
- **Entry sequence:**
  1. `setupDb()` - Initialize SQLite database
  2. Parse CLI arguments
  3. Connect to MCP servers (`cli.tsx:137-155`)
  4. Render Ink React app

**CLI Options:**

- `--config <path>` - Custom config file path
- `--unchained` - Skip confirmation for all tools (dangerous mode)
- `--connect <target>` - Connect to Docker container
- Subcommands: `version`, `init`, `changelog`, `list`, `bench`, `docker`, `prompt`

## Main Application Loop

**File:** `source/app.tsx:141-229` - Main App component (Ink-based TUI)
**File:** `source/state.ts:119-547` - Zustand store with core logic

**Conversation Flow:**

1. User input → `state.ts:134-145` (`input()` action)
2. `_runAgent()` triggers `trajectoryArc()`
3. LLM response streams back via `compilers/run.ts`
4. Tool calls are extracted and dispatched via `state.ts:322-365` (`runTool()`)
5. Tool results serialized to context, loop continues

**Key UI State Modes (state.ts:30-86):**

- `input` - Waiting for user input
- `responding` - LLM generating response
- `tool-request` - Tool call pending user confirmation
- `tool-waiting` - Tool executing
- `fix-json` - Autofixing malformed JSON
- `diff-apply` - Autofixing diff search/replace
- `compacting` - History compaction in progress

## Tool Dispatch Architecture

**Registry:** `source/tools/tool-defs/index.ts:15-29`

Built-in tools loaded as a map:

- `read`, `list`, `shell`, `edit`, `create`, `mcp`, `fetch`, `append`, `prepend`, `rewrite`, `skill`, `web-search`, `glob`

**Tool Definition Pattern:** `source/tools/common.ts:53-76`

```typescript
type ToolDef<T> = {
  ArgumentsSchema: t.Type<any>; // For LLM schema generation
  Schema: t.Type<T>; // Full validation schema
  validate: (signal, transport, call, config) => Promise<null>;
  run: (signal, transport, call, config, modelOverride) => Promise<ToolResult>;
};
```

**Tool Execution Flow:**

1. `tools/index.ts:43-53` - `runTool()` looks up tool via `lookup()`
2. `validate()` called first for pre-flight checks
3. `run()` executes tool and returns `ToolResult`
4. Results converted to IR via `ir/convert-history-ir.ts:257-301`

## MCP Tool Integration

**File:** `source/tools/tool-defs/mcp.ts:1-243`

**Connection Lifecycle:**

1. Boot: `cli.tsx:137-155` connects to all configured MCP servers
2. Client caching: `mcp.ts:64-76` (`getMcpClient()`)
3. Schema fetching: `mcp.ts:167-176` - `client.listTools()` called at runtime
4. Tool execution: `mcp.ts:178-184` - `client.callTool()`
5. Shutdown: `cli.tsx:190` - `shutdownMcpClients()`

**MCP Configuration Schema (config.ts:47-51):**

```typescript
McpServerConfigSchema = {
  command: string,
  args?: string[],
  env?: Record<string, string>
}
```

## Autofix Models

**File:** `source/compilers/autofix.ts:1-104`

Two specialized models for error recovery:

### fixJson (config.fixJson)

- **Purpose:** Repair malformed JSON in tool call arguments
- **Entry:** `autofix.ts:42-53` (`autofixJson()`)
- **Invocation:** `compilers/standard.ts:620-630` when JSON.parse fails
- **Prompt:** `prompts/autofix-prompts.ts:39-52`
- **Model:** Configurable via `octofriend.json5` `fixJson` field

### diffApply (config.diffApply)

- **Purpose:** Fix fuzzy search/replace strings in edit tool
- **Entry:** `autofix.ts:14-40` (`autofixEdit()`)
- **Invocation:** `agent/trajectory-arc.ts:278-325` when edit validation fails
- **Prompt:** `prompts/autofix-prompts.ts:13-27`
- **Model:** Configurable via `octofriend.json5` `diffApply` field

## Thinking/Reasoning Token Management

**Supported Formats:**

1. **Native reasoning_content** (OpenAI compatible APIs) - `compilers/standard.ts:462-465`
2. **Native reasoning field** (Anthropic) - `compilers/standard.ts:466-469`
3. **XML ` ` tags** - `compilers/standard.ts:408-430` via `StreamingXMLParser`

**Storage:**

- `llm-ir.ts:27` - `reasoningContent?: string` on AssistantMessage
- `llm-ir.ts:11-22` - Anthropic thinking blocks (signed + redacted)
- `llm-ir.ts:28-31` - OpenAI encrypted reasoning content

**UI Rendering:**

- `app.tsx:1292-1379` - `ThoughtBox` component with scrollable display
- `app.tsx:1297-1302` - Reserved space calculation for thoughts in terminal

## Config Schema (octofriend.json5)

**File:** `source/config.ts:96-136`

```typescript
ConfigSchema = {
  configVersion?: number,
  yourName: string,
  models: ModelConfig[],

  // Autofix models
  diffApply?: { baseUrl, apiEnvVar?, auth?, model },
  fixJson?: { baseUrl, apiEnvVar?, auth?, model },

  // Search integration
  search?: { url, apiEnvVar?, auth? },

  // MCP servers
  mcpServers?: Record<string, McpServerConfig>,

  // UI options
  vimEmulation?: { enabled: boolean },

  // API key overrides
  defaultApiKeyOverrides?: Record<string, string>,

  // Skills
  skills?: { paths?: string[] }
}

ModelConfig = {
  type?: "standard" | "openai-responses" | "anthropic",
  nickname: string,
  baseUrl: string,
  apiEnvVar?: string,  // deprecated
  auth?: { type: "env", name: string } | { type: "command", command: string[] },
  model: string,
  context: number,    // context window size
  reasoning?: "low" | "medium" | "high",
  modalities?: { image?: { enabled, maxSizeMB, acceptedMimeTypes } }
}
```

## Key Source Files

| File                              | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `source/cli.tsx`                  | CLI entry, MCP boot, command routing                    |
| `source/app.tsx`                  | Ink TUI, message rendering, tool UI components          |
| `source/state.ts`                 | Zustand store, agent loop orchestration, tool execution |
| `source/config.ts`                | Config parsing, auth resolution, key management         |
| `source/tools/index.ts`           | Tool loading, execution dispatch                        |
| `source/tools/tool-defs/`         | Built-in tool implementations                           |
| `source/agent/trajectory-arc.ts`  | Main agent loop, compaction, autofix routing            |
| `source/compilers/run.ts`         | Compiler selection (standard, anthropic, responses)     |
| `source/compilers/standard.ts`    | OpenAI-compatible LLM streaming, tool parsing           |
| `source/compilers/autofix.ts`     | diffApply and fixJson autofix invocations               |
| `source/ir/llm-ir.ts`             | Internal representation types for LLM messages          |
| `source/ir/convert-history-ir.ts` | History → LLM IR conversion                             |
| `source/prompts/system-prompt.ts` | Dynamic system prompt with tools, MCP, context          |
| `source/history.ts`               | History item type definitions                           |
