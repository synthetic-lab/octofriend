# BatchToolExecution Insertion Point Analysis

## Overview

This document identifies the exact files and functions where a `BatchToolExecution` pseudo-tool could be integrated into the Octofriend codebase.

## Tool Registration Point

### Option 1: New Tool Module (Recommended)

**File to create:** `source/tools/tool-defs/batch.ts`

**Registration:** Add to `source/tools/tool-defs/index.ts:15-29`

```typescript
import batch from "./batch.ts";

export default {
  read,
  list,
  // ... other tools
  batch, // <-- Add here
};
```

**Pattern to follow (from `source/tools/tool-defs/read.ts:1-49`):**

```typescript
import { t } from "structural";
import { defineTool } from "../common.ts";

const ArgumentsSchema = t.subtype({
  calls: t.array(
    t.subtype({
      tool: t.str,
      arguments: t.any,
    }),
  ),
  parallel: t.optional(t.bool),
});

const Schema = t
  .subtype({
    name: t.value("batch"),
    arguments: ArgumentsSchema,
  })
  .comment("Execute multiple tools in a single call...");

export default defineTool<t.GetType<typeof Schema>>(async () => ({
  Schema,
  ArgumentsSchema,
  validate: async () => null, // Delegate to sub-tools
  run: async (abortSignal, transport, call, config, modelOverride) => {
    // Batch execution logic
  },
}));
```

### Existing Tool Registry

**Current structure:** `source/tools/tool-defs/index.ts:15-29`

The registry is a simple object map. Adding a new tool requires:

1. Create tool module in `source/tools/tool-defs/{name}.ts`
2. Import and add to the default export in `index.ts`

## Tool Result Serialization Point

### Primary Location: `source/ir/convert-history-ir.ts:257-301`

This is where tool results are converted to LLM IR. For batch execution, the batch tool would need to return a compound result that gets serialized as multiple IR entries.

**Current tool-output handling:**

```typescript
// convert-history-ir.ts:292-301
case "skill":
case "fetch":
case "list":
case "shell":
case "mcp":
case "web-search":
case "glob":
  return [
    prev,
    {
      role: "tool-output",
      content: item.result.content,
      toolCall: prev.toolCall,
    },
  ];
```

**Batch serialization approach:**

Option A: Return a special `batch` IR type that expands to multiple tool-output entries
Option B: Batch tool returns multiple results, `outputToHistory` in `convert-history-ir.ts:33-39` handles flattening

### Secondary Location: `source/compilers/standard.ts:196-277`

**`llmFromIr()` function** - Converts IR back to LLM messages. Tool results become:

```typescript
// standard.ts:196-202 (tool-output IR → LLM tool message)
if (ir.role === "tool-output") {
  return {
    role: "tool",
    tool_call_id: ir.toolCall.toolCallId,
    content: ir.content,
  };
}
```

## Execution Flow Integration

### Entry Point: `source/tools/index.ts:43-53`

```typescript
export async function runTool(
  abortSignal: AbortSignal,
  transport: Transport,
  loaded: Partial<LoadedTools>,
  call: ToolCall,
  config: Config,
  modelOverride: string | null,
): Promise<ToolResult> {
  const def = lookup(loaded, call);
  return await def.run(abortSignal, transport, call, config, modelOverride);
}
```

**Batch tool run() signature:**

```typescript
async run(
  abortSignal: AbortSignal,
  transport: Transport,
  call: BatchToolCall,
  config: Config,
  modelOverride: string | null,
): Promise<ToolResult> {
  // Execute sub-tools in parallel/sequence
  // Return aggregated result
}
```

### State Integration: `source/state.ts:322-365`

Current `runTool` action:

```typescript
runTool: async ({ config, toolReq, transport }) => {
  const tools = await loadTools(transport, abortController.signal, config);
  const result = await runTool(/* ... */);

  const toolHistoryItem: HistoryItem = {
    type: "tool-output",
    id: sequenceId(),
    result,
    toolCallId: toolReq.toolCallId,
  };
  // ...
};
```

**Batch considerations:**

- Batch tool returns multiple results → need multiple history items OR
- Single history item with compound result that renders as multiple outputs

## UI/Display Considerations

### Tool Renderer Location: `source/app.tsx:990-1019`

```typescript
function ToolMessageRenderer({ item }: { item: ToolCallItem }) {
  switch (item.tool.function.name) {
    case "read": return <ReadToolRenderer ... />;
    case "batch": return <BatchToolRenderer item={item} />;  // Add case
  }
}
```

### Output Renderer Location: `source/app.tsx:894-905`

```typescript
if (item.type === "tool-output") {
  const lines = item.result.lines ?? item.result.content.split("\n").length;
  return (
    <Box marginBottom={1}>
      <Text color="gray">Got <Text>{lines}</Text> lines of output</Text>
    </Box>
  );
}
```

**TOON (Tool Output On Next) formatting decision:**

Options:

1. **Tool result serializer** (`convert-history-ir.ts`): Batch tool returns structured data, serializer expands to multiple tool-output IR entries with appropriate formatting
2. **Individual tool executor**: Each sub-tool formats its own output, batch tool aggregates

**Recommended approach:** Tool result serializer (Option 1) - maintains separation of concerns and allows the batch tool to stay agnostic of display formatting.

## LLM Schema Integration

### System Prompt Generation: `source/prompts/system-prompt.ts:42-51`

Tools are dynamically listed in system prompt:

```typescript
${Object.entries(tools)
  .filter(([toolName, _]) => { /* MCP filter */ })
  .map(([_, tool]) => toTypescript(tool.Schema))
  .join("\n\n")}
```

**Batch tool schema** would automatically appear here once added to the registry.

## Parallel Execution Considerations

### Current AbortSignal Handling

Tools receive an `AbortSignal` for cancellation:

```typescript
// tools/common.ts:57-63
type ToolDef<T> = {
  run: (
    abortSignal: AbortSignal,
    transport: Transport,
    t: T,
    cfg: Config,
    modelOverride: string | null,
  ) => Promise<ToolResult>;
};
```

**Batch tool abort handling:**

- Single abortSignal passed to all sub-tools
- `Promise.all()` or `Promise.allSettled()` for parallel execution
- All sub-tools abort together

### Transport Concurrency

**File:** `source/transports/transport-common.ts` - Transport interface

Current transport implementations (Local, Docker) handle individual calls sequentially. Batch tool would:

1. Fire multiple transport calls concurrently
2. Aggregate results

## MCP Tool Delegation

### Reusing MCP Tools in Batch

**Location:** `source/tools/tool-defs/mcp.ts:131-241`

The MCP tool has internal tool lookup logic:

```typescript
const tools = await withAbort(client.listTools());
const tool = tools.tools.find(t => t.name === toolName);
const result = await withAbort(client.callTool({ name: toolName, arguments: toolArgs }));
```

**Batch tool could:**

- Accept `mcp` as a sub-tool type
- Delegate to MCP client via `getMcpClient()`
- Or: Use existing `runTool()` dispatcher with `loadedTools`

## Minimal New Tool Module Template

Based on `source/tools/tool-defs/read.ts` pattern:

```typescript
// source/tools/tool-defs/batch.ts
import { t } from "structural";
import { defineTool, ToolResult } from "../common.ts";
import { runTool } from "../index.ts";

const ArgumentsSchema = t.subtype({
  calls: t.array(
    t.subtype({
      name: t.str,
      arguments: t.any,
    }),
  ),
  parallel: t.optional(t.bool),
});

const Schema = t.subtype({
  name: t.value("batch"),
  arguments: ArgumentsSchema,
}).comment(`
Execute multiple tools in a single call. 
Each call in the array is executed sequentially by default, 
or in parallel if parallel=true.
`);

export default defineTool<t.GetType<typeof Schema>>(async (signal, transport, config) => ({
  Schema,
  ArgumentsSchema,

  validate: async () => null, // Sub-tools validated at execution time

  async run(abortSignal, transport, call, config, modelOverride) {
    const { calls, parallel = false } = call.arguments;

    // Load all tools
    const loaded = await loadTools(transport, abortSignal, config);

    // Execute calls
    const results: ToolResult[] = [];

    if (parallel) {
      const promises = calls.map(c =>
        runTool(abortSignal, transport, loaded, c, config, modelOverride).catch(e => ({
          content: `Error: ${e.message}`,
          error: true,
        })),
      );
      results.push(...(await Promise.all(promises)));
    } else {
      for (const c of calls) {
        const result = await runTool(abortSignal, transport, loaded, c, config, modelOverride);
        results.push(result);
      }
    }

    // Return aggregated result - serializer handles display formatting
    return {
      content: JSON.stringify(results.map(r => r.content)),
      batchResults: results, // Extension for batch-aware serializer
    };
  },
}));
```

## Summary of Insertion Points

| Component          | File                               | Line/Function         | Purpose                          |
| ------------------ | ---------------------------------- | --------------------- | -------------------------------- |
| Tool Registration  | `tools/tool-defs/index.ts`         | Export object         | Add batch to tool map            |
| Tool Definition    | `tools/tool-defs/batch.ts`         | New file              | Implement batch logic            |
| Execution Dispatch | `tools/index.ts:43-53`             | `runTool()`           | Already generic, supports batch  |
| IR Serialization   | `ir/convert-history-ir.ts:257-301` | Tool output handling  | May need batch expansion         |
| LLM Conversion     | `compilers/standard.ts:196-277`    | `llmFromIr()`         | Tool → LLM message               |
| UI Rendering       | `app.tsx:990-1019`                 | `ToolMessageRenderer` | Add batch case                   |
| State Integration  | `state.ts:322-365`                 | `runTool` action      | May need batch result flattening |
