# Tool Dispatch Pipeline

## Lifecycle of a Tool Call

### 1. LLM Response → Tool Call Extraction

**Location:** `source/compilers/standard.ts:432-580`

```
LLM streams response → XML parser extracts tool_calls →
  currTool accumulates: {id, function: {name, arguments}}
```

- Streaming parser handles partial tool call chunks
- Tool calls are detected via delta from LLM (`delta.tool_calls`)
- Raw tool call accumulated in `currTool` variable
- On stream end: `ResponseToolCallSchema.sliceResult(currTool)` validates structure

### 2. Tool Call Parsing & Validation

**Location:** `source/compilers/standard.ts:593-685` (`parseTool()`)

**Steps:**

1. Look up tool definition by name (`toolDefs[name]`)
2. Parse JSON arguments:
   - First attempt: `JSON.parse(toolCall.function.arguments)`
   - **On failure:** invoke `autofixJson()` → `compilers/autofix.ts:42-53`
   - Handle double-encoding: re-parse if args is a string
3. Validate against tool schema: `toolSchema.slice({name, arguments})`
4. Return `ToolCallRequest` or error

### 3. Tool Execution

**Location:** `source/state.ts:322-365` (`runTool()` action)

```typescript
async runTool({ config, toolReq, transport }) {
  const tools = await loadTools(transport, abortController.signal, config);
  const result = await runTool(abortSignal, transport, tools, toolReq.function, config, modelOverride);
  // result → history as ToolOutputItem
}
```

**Execution Flow:**

1. `tools/index.ts:43-53` - `runTool()` dispatcher
2. `tools/index.ts:66-70` - `lookup()` finds tool definition
3. `ToolDef.validate()` - Pre-flight checks (file exists, etc.)
4. `ToolDef.run()` - Execute tool, return `ToolResult`

### 4. Tool Result → Context Serialization

**Location:** `source/ir/convert-history-ir.ts:257-301`

Tool results are converted to IR based on tool type:

| Tool                                             | IR Type       | Notes                               |
| ------------------------------------------------ | ------------- | ----------------------------------- |
| read                                             | `file-read`   | Content + path, image if applicable |
| create, edit, append, prepend, rewrite           | `file-mutate` | Path recorded for change tracking   |
| shell, fetch, list, mcp, web-search, glob, skill | `tool-output` | Plain content                       |

**IR to LLM Message Conversion:** `source/compilers/standard.ts:138-278` (`llmFromIr()`)

- `file-read` → `role: "tool"` or multimodal user message with image
- `file-mutate` → `role: "tool"` with mutation notification
- `tool-output` → `role: "tool"` with content
- `tool-reject` → `role: "tool"` with error tag
- `tool-error` → `role: "tool"` with error tag
- `tool-malformed` → `role: "user"` with error (triggers retry)

## Batching, Queuing, Parallelism

**Current State: Sequential Only**

- Single tool call per LLM response (OpenAI-compatible APIs)
- Tool execution is blocking: `state.ts:322-365`
- No internal queue - each tool request triggers `_runAgent()` continuation

**Concurrency:**

- `tools/index.ts:20-28` - `loadTools()` loads all tool definitions in parallel via `Promise.all`
- Individual tools may use async operations internally

## Error Handling & Autofix Routing

### Malformed JSON Path

**Trigger:** `standard.ts:616-620` - JSON.parse throws

```
JSON.parse fails → autofixJson() invoked →
  success: retry with fixed JSON →
  failure: return tool-malformed IR →
    trajectoryArc retries entire arc (state.ts:208-224)
```

### Edit Validation Failure

**Trigger:** `agent/trajectory-arc.ts:239-249` - `validateTool()` throws

```
ToolError on edit → autofixEdit() invoked (trajectory-arc.ts:278-325) →
  success: validate fixed edit → return tool request →
  failure: return tool-error IR → retry arc with error context
```

### File Outdated Error

**Trigger:** `file-tracker.ts` detects file modified since read

```
FileOutdatedError → tryTransformFileOutdatedError() →
  file-outdated IR → retry arc with re-read prompt (trajectory-arc.ts:250-273)
```

## Token Budget / Context Management

### Autocompaction

**Trigger:** `compilers/autocompact.ts:71-98` (`shouldAutoCompactHistory()`)

```
Token threshold exceeded (DEFAULT_AUTOCOMPACT_THRESHOLD = 0.8 of context) →
  generateCompactionSummary() →
    compaction-checkpoint IR inserted →
      checkpoint excludes prior history from context window
```

**Compaction Process:**

- `agent/trajectory-arc.ts:109-125` - `maybeAutocompact()` called before each LLM request
- `compilers/autocompact.ts:100-149` - Summary generation via dedicated LLM call
- History sliced at checkpoint: `compilers/run.ts:41-42`

### Token Tracking

**File:** `source/token-tracker.ts:1-12`

- Global token counts per model
- Tracked in `compilers/standard.ts:514-522`
- Displayed on exit: `cli.tsx:179-188`

### MCP Response Size Limiting

**Location:** `source/tools/tool-defs/mcp.ts:186-204`

```typescript
const MAX_SIZE = model.context; // Cap at model's context window
if (content.text.length > MAX_SIZE) throw new ToolError("Text content too large");
```

## Tool Confirmation & Whitelisting

**Location:** `source/app.tsx:652-802` (`ToolRequestRenderer`)

**Confirmation Levels:**

- `SKIP_CONFIRMATION_TOOLS` (read, list, skill, web-search, glob) - Always execute
- `ALWAYS_REQUEST_PERMISSION_TOOLS` (shell) - Always confirm
- Whitelist check: `app.tsx:728-735` - User can "Yes, and always allow"
- Unchained mode: Bypasses all confirmation

**Whitelist Keys:**

- `read:*` - All file reads
- `edits:*` - All file modifications
- `shell:*` - All shell commands
- `mcp:{server}:{tool}` - Specific MCP tool
- etc.

## IR Type Reference

**Input IR (sent to LLM):** `source/ir/llm-ir.ts:105-116`

- user, tool-output, file-read, file-mutate, tool-reject, tool-error, tool-malformed, file-outdated, file-unreadable, compaction-checkpoint

**Output IR (from LLM):** `source/ir/llm-ir.ts:103`

- assistant, tool-malformed

**Tool Call Request:** `source/ir/llm-ir.ts:4-8`

```typescript
{
  type: "function",
  function: ToolCall,  // { name, arguments }
  toolCallId: string
}
```
