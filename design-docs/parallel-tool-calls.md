# Design Document: Native Parallel Tool Call Support

## Overview

Replace the custom "batch" pseudo-tool approach with native parallel tool call support using the OpenAI/Anthropic-compatible APIs' built-in `tool_calls` array.

## Current State

### Limitations

- `AssistantMessage.toolCall` is optional single `ToolCallRequest`
- Standard compiler stops parsing after first tool call (`doneParsingTools = true`)
- Trajectory arc executes one tool at a time
- History IR stores single tool calls per assistant message

### Code Locations

| Component     | File                              | Key Area                                      |
| ------------- | --------------------------------- | --------------------------------------------- |
| IR Types      | `source/ir/llm-ir.ts`             | `AssistantMessage.toolCall?: ToolCallRequest` |
| Compiler      | `source/compilers/standard.ts`    | `currTool` variable, parsing loop             |
| IR Conversion | `source/ir/convert-history-ir.ts` | `llmFromIr` assistant handling                |
| Execution     | `source/agent/trajectory-arc.ts`  | Tool execution loop                           |
| History       | `source/ir/history.ts`            | History item storage                          |

## Proposed Changes

### Phase 1: IR Type Changes

**File: `source/ir/llm-ir.ts`**

```typescript
// Change from:
export type AssistantMessage = {
  role: "assistant";
  content: string;
  reasoningContent?: string | null;
  // ... other fields
  toolCall?: ToolCallRequest; // ← single optional
  tokenUsage: number;
  outputTokens: number;
};

// Change to:
export type AssistantMessage = {
  role: "assistant";
  content: string;
  reasoningContent?: string | null;
  // ... other fields
  toolCalls?: ToolCallRequest[]; // ← array, undefined if no calls
  tokenUsage: number;
  outputTokens: number;
};
```

**Impact:** All references to `toolCall` must be updated to `toolCalls`.

### Phase 2: Compiler Changes

**File: `source/compilers/standard.ts`**

Replace single `currTool` tracking with Map-based tracking:

```typescript
// Current:
let currTool: Partial<ResponseToolCall> | null = null;
let doneParsingTools = false;

// New:
const currTools = new Map<string, Partial<ResponseToolCall>>();
let hasParsedTools = false;
```

Update parsing logic to accumulate all tool calls:

```typescript
// In the streaming loop:
if (delta && "tool_calls" in delta && delta.tool_calls) {
  for (const deltaCall of delta.tool_calls) {
    onTokens((deltaCall.function.name || "") + (deltaCall.function.arguments || ""), "tool");

    const existing = currTools.get(deltaCall.id);
    if (!existing) {
      currTools.set(deltaCall.id, {
        id: deltaCall.id,
        function: {
          name: deltaCall.function.name || "",
          arguments: deltaCall.function.arguments || "",
        },
      });
    } else {
      if (deltaCall.function.name) existing.function!.name = deltaCall.function.name;
      if (deltaCall.function.arguments)
        existing.function!.arguments += deltaCall.function.arguments;
    }
    hasParsedTools = true;
  }
}
```

Validation now processes all tools:

```typescript
// Current: validates single tool
// New: validate all tools, collect errors
const toolResults: ToolCallRequest[] = [];
const errors: Array<{ toolCallId: string; error: string }> = [];

for (const [id, tool] of currTools) {
  const validated = ResponseToolCallSchema.sliceResult(tool);
  if (validated instanceof t.Err) {
    errors.push({ toolCallId: id, error: validated.message });
  } else {
    const parsed = await parseTool(validated, toolDefs, autofixJson, abortSignal);
    if (parsed.status === "error") {
      errors.push({ toolCallId: id, error: parsed.message });
    } else {
      toolResults.push(parsed.tool);
    }
  }
}

assistantIr.toolCalls = toolResults.length > 0 ? toolResults : undefined;
```

### Phase 3: IR Conversion Changes

**File: `source/ir/convert-history-ir.ts`**

Update `llmFromIr` to handle multiple tool calls:

```typescript
// Current: single tool_call
if (toolCall == null || prev?.role === "tool-malformed") {
  return { ... };
}
return {
  ...reasoning,
  role: "assistant",
  content: ir.content,
  tool_calls: [
    {
      type: "function",
      function: { name: ..., arguments: ... },
      id: toolCall.toolCallId,
    },
  ],
};

// New: multiple tool_calls
if (!toolCalls || toolCalls.length === 0 || prev?.role === "tool-malformed") {
  return { ... };
}
return {
  ...reasoning,
  role: "assistant",
  content: ir.content,
  tool_calls: toolCalls.map(tc => ({
    type: "function" as const,
    function: {
      name: tc.function.name,
      arguments: JSON.stringify(tc.function.arguments),
    },
    id: tc.toolCallId,
  })),
};
```

### Phase 4: Execution Changes

**File: `source/agent/trajectory-arc.ts`**

Current execution loop handles single tool:

```typescript
// Current pattern:
if (assistant.toolCall) {
  const result = await executeTool(assistant.toolCall);
  // ... handle result
}
```

New pattern supports multiple tools with parallel/sequential options:

```typescript
// New pattern:
if (assistant.toolCalls && assistant.toolCalls.length > 0) {
  const results = await executeToolCalls(assistant.toolCalls, {
    parallel: config.parallelToolExecution !== false, // default true
    maxConcurrency: config.maxParallelTools || 5,
  });
  // ... handle results
}
```

Execution strategy:

```typescript
async function executeToolCalls(
  toolCalls: ToolCallRequest[],
  options: { parallel: boolean; maxConcurrency: number },
): Promise<ToolResult[]> {
  if (!options.parallel) {
    // Sequential execution
    const results: ToolResult[] = [];
    for (const call of toolCalls) {
      results.push(await executeSingleTool(call));
    }
    return results;
  }

  // Parallel execution with concurrency limit
  const batches = chunk(toolCalls, options.maxConcurrency);
  const results: ToolResult[] = [];

  for (const batch of batches) {
    const batchResults = await Promise.all(batch.map(call => executeSingleTool(call)));
    results.push(...batchResults);
  }

  return results;
}
```

### Phase 5: History Storage

**File: `source/ir/history.ts`** (or wherever HistoryItems are stored)

Ensure `toolCalls` array is properly serialized/deserialized. SQLite JSON columns should handle this automatically, but verify:

```typescript
// When saving assistant message:
historyItem.toolCalls = assistant.toolCalls; // array or undefined

// When loading:
assistant.toolCalls = historyItem.toolCalls; // should restore as array
```

## Files to Modify

| File                              | Changes                            | Lines (est.) |
| --------------------------------- | ---------------------------------- | ------------ |
| `source/ir/llm-ir.ts`             | `toolCall` → `toolCalls` array     | ~5           |
| `source/compilers/standard.ts`    | Multi-tool parsing, validation     | ~50          |
| `source/ir/convert-history-ir.ts` | Multi-tool conversion              | ~20          |
| `source/agent/trajectory-arc.ts`  | Multi-tool execution loop          | ~40          |
| `source/compilers/anthropic.ts`   | Same changes as standard           | ~30          |
| `source/compilers/responses.ts`   | Same changes as standard           | ~30          |
| `source/ir/history.ts`            | Serialization support              | ~10          |
| `source/config.ts`                | Add `parallelToolExecution` option | ~5           |

**Total estimated:** ~190 lines changed across 8 files

## Configuration Options

Add to `Config` type in `source/config.ts`:

```typescript
parallelToolExecution?: boolean;  // default: true
maxParallelTools?: number;        // default: 5
```

## Testing Strategy

### Unit Tests

1. Compiler parses multiple tool calls correctly
2. IR conversion handles toolCalls array
3. Execution respects parallel/sequential settings

### Integration Tests

1. LLM returns single tool call (backward compat)
2. LLM returns multiple tool calls
3. Mix of read/list operations in parallel
4. File mutations (should probably be sequential for safety)

### Edge Cases

1. Empty toolCalls array
2. Malformed one of multiple calls
3. Abort during parallel execution
4. Rate limiting with parallel calls

## Migration Considerations

### Backward Compatibility

- Old histories with `toolCall` (singular) need migration
- Options:
  1. Migration script: `toolCall` → `toolCalls: [toolCall]`
  2. Runtime conversion: check both fields on load

### Database Schema

- SQLite JSON column should auto-handle array vs object
- Test with existing history databases

## PR Scope (What to Include)

✅ **INCLUDED:**

- Native parallel tool call support
- `toolCalls` array in IR types
- Multi-tool parsing in compilers
- Parallel/sequential execution
- Configuration options
- Tests

❌ **NOT INCLUDED (keep in branch):**

- TOON format support
- Custom batch pseudo-tool
- Alternative serialization formats

## Branch Strategy

```
main
├── feat/native-parallel-tools     # ← PR branch (this work)
│   └── (clean implementation)
│
└── feat/toon-support              # ← Your branch
    ├── merge: feat/native-parallel-tools
    └── + TOON serialization
```

After the parallel tools PR is merged:

1. Merge `main` into `feat/toon-support`
2. Add TOON serialization on top
3. TOON stays in your branch, not upstreamed

## Implementation Order

1. **IR Types** - Change `toolCall` to `toolCalls` array
2. **Compiler (Standard)** - Multi-tool parsing
3. **IR Conversion** - Multi-tool to LLM messages
4. **Execution** - Parallel tool execution
5. **Other Compilers** - Anthropic, Responses
6. **Config** - Add options
7. **Tests** - Unit and integration
8. **Migration** - History backward compat

## Risks & Mitigations

| Risk                                  | Mitigation                                   |
| ------------------------------------- | -------------------------------------------- |
| Breaking history format               | Runtime conversion or migration script       |
| Race conditions in parallel execution | Concurrency limit, proper abort handling     |
| LLMs not using multiple tools         | Still supports single tool (backward compat) |
| Token counting changes                | Ensure `sumAssistantTokens` handles arrays   |

## Success Criteria

- [ ] Multiple tool calls parsed from single LLM response
- [ ] Tools execute in parallel by default
- [ ] Sequential mode available for file mutations
- [ ] All existing tests pass
- [ ] New tests for parallel execution
- [ ] Backward compatible with old histories
- [ ] No TOON code in the PR
