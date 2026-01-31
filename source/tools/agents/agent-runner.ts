import { Agent } from "./agent-parser.ts";
import { Config, getModelFromConfig, readKeyForModel } from "../../config.ts";
import { Transport } from "../../transports/transport-common.ts";
import { trajectoryArc } from "../../agent/trajectory-arc.ts";
import { LlmIR, UserMessage } from "../../ir/llm-ir.ts";
import { loadTools, runTool } from "../../tools/index.ts";
import { useTaskStore, TaskProgress } from "../../task-manager.ts";

export type SubAgentResult = {
  content: string;
};

export type SubAgentOptions = {
  agent: Agent;
  prompt: string;
  files: string[];
  timeout: number;
  abortSignal: AbortSignal;
  config: Config;
  transport: Transport;
  model?: string; // Runtime model nickname override
  taskId?: string; // Optional task ID for tracking in task store
};

export async function runSubAgent(options: SubAgentOptions): Promise<SubAgentResult> {
  const {
    agent,
    prompt,
    files,
    abortSignal,
    config,
    transport,
    model: runtimeModel,
    taskId,
  } = options;

  // Helper to report progress (to task store only - UI handles display)
  const reportProgress = (progress: TaskProgress) => {
    if (taskId) {
      useTaskStore.getState().updateTaskProgress(taskId, progress);
    }
  };

  if (abortSignal.aborted) {
    return { content: "" };
  }

  // Report starting
  reportProgress({ type: "starting", message: `Initializing ${agent.name}...` });

  // Build file context
  const fileContents: string[] = [];
  if (files.length > 0) {
    reportProgress({ type: "reading_files", files });
  }
  for (const filePath of files) {
    if (abortSignal.aborted) {
      return { content: "" };
    }
    try {
      const content = await transport.readFile(abortSignal, filePath);
      fileContents.push(`<file path="${filePath}">\n${content}\n</file>`);
    } catch {
      // Skip files that can't be read
    }
  }

  // Build the full prompt with file context
  let fullPrompt = prompt;
  if (fileContents.length > 0) {
    fullPrompt = `${fileContents.join("\n\n")}\n\n${prompt}`;
  }

  // Build messages for the trajectory arc
  const messages: LlmIR[] = [
    {
      role: "user",
      content: fullPrompt,
    } as UserMessage,
  ];

  // Determine model using priority: runtime > agent static > config default > parent
  const parentModel = getModelFromConfig(config, null);
  let model: ReturnType<typeof getModelFromConfig>;

  if (runtimeModel) {
    // Runtime override takes highest priority - lookup by nickname
    model = getModelFromConfig(config, runtimeModel);
  } else if (agent.model && agent.model !== "inherit") {
    // Check if agent.model matches a nickname in config
    const matchingConfig = config.models.find(m => m.nickname === agent.model);
    if (matchingConfig) {
      // Use the complete model config from the nickname
      model = matchingConfig;
    } else {
      // Fall back to using agent.model as model name with parent config
      model = { ...parentModel, model: agent.model };
    }
  } else if (config.defaultSubAgentModel) {
    // Config default sub-agent model takes third priority
    model = getModelFromConfig(config, config.defaultSubAgentModel);
  } else {
    // Default to parent model
    model = parentModel;
  }

  // Get API key
  const apiKey = await readKeyForModel(model, config);
  if (!apiKey) {
    throw new Error(`No API key available for model ${model.model}`);
  }

  if (abortSignal.aborted) {
    return { content: "" };
  }

  // Load and filter tools based on agent configuration
  const allTools = await loadTools(transport, abortSignal, config);
  let filteredTools = allTools;

  if (agent.tools && agent.tools.length > 0) {
    // Allowlist: only include specified tools
    filteredTools = {};
    for (const toolName of agent.tools) {
      if (toolName in allTools) {
        // @ts-ignore
        filteredTools[toolName] = allTools[toolName];
      }
    }
  }

  if (agent.disallowedTools && agent.disallowedTools.length > 0) {
    // Denylist: remove specified tools
    for (const toolName of agent.disallowedTools) {
      if (toolName in filteredTools) {
        // @ts-ignore
        delete filteredTools[toolName];
      }
    }
  }

  // Build agent-specific system prompt
  const agentSystemPrompt = async () => {
    const toolList = agent.tools?.length ? agent.tools.join(", ") : "all available tools";
    const disallowedList = agent.disallowedTools?.length
      ? agent.disallowedTools.join(", ")
      : "none";

    return `You are a specialized sub-agent named "${agent.name}".

${agent.systemPrompt}

## Your Capabilities
- You have access to ${toolList}
- Disallowed tools: ${disallowedList}
- Model: ${model.model} (${runtimeModel ? "runtime override" : agent.model && agent.model !== "inherit" ? "agent static" : "inherited from parent"})

## Your Task
The user has delegated a specific task to you. Focus only on this task and return your findings.

## Context
Working directory: ${await transport.cwd(abortSignal)}

## Output Format (CRITICAL)
You are a background sub-agent. Your output will be returned directly to the parent agent as a tool result.
- DO NOT output verbose "thought" blocks or narrate your tool usage
- DO NOT use emoji or decorative formatting like "🐙" blocks
- DO NOT say "Let me read the file..." or "Got X lines of output" - just use the tools silently
- Provide COMPREHENSIVE and DETAILED findings - the parent agent needs substantial information
- Include specific file paths, line numbers, and code examples in your analysis
- Be thorough in your exploration - the user wants detailed insights, not summaries

Remember: You are running in an isolated context. The parent agent handles all user interaction. Your job is to do the deep work and return detailed results.`;
  };

  // Track assistant response content from the buffer
  let assistantContent = "";
  let hasReportedThinking = false;

  // Run the full conversation loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (abortSignal.aborted) {
      return { content: "" };
    }

    // Reset captured content for this arc
    assistantContent = "";

    // Run the trajectory arc
    const finish = await trajectoryArc({
      apiKey,
      model,
      messages,
      config,
      transport,
      abortSignal,
      handler: {
        startResponse: () => {
          // Only report once per response cycle to avoid spam
          if (!hasReportedThinking) {
            hasReportedThinking = true;
            reportProgress({ type: "thinking", message: `${agent.name} is analyzing...` });
          }
        },
        responseProgress: state => {
          // Capture content from the buffer as it streams in
          if (state.buffer.content) {
            assistantContent = state.buffer.content;
          }
        },
        startCompaction: () => {},
        compactionProgress: () => {},
        compactionParsed: () => {},
        autofixingJson: () => {},
        autofixingDiff: () => {},
        retryTool: () => {},
      },
      systemPrompt: agentSystemPrompt,
      tools: filteredTools,
    });

    if (abortSignal.aborted) {
      return { content: "" };
    }

    // Add any IRs from the finish to the conversation history
    // This includes assistant messages with tool calls
    for (const ir of finish.irs) {
      if (ir.role === "assistant") {
        // Add the assistant message (may include tool call)
        messages.push(ir as LlmIR);
      }
    }

    // Report token usage from assistant messages
    const totalTokens = finish.irs.reduce((sum, ir) => {
      if (ir.role === "assistant" && ir.tokenUsage) {
        return sum + ir.tokenUsage;
      }
      return sum;
    }, 0);
    if (totalTokens > 0) {
      reportProgress({ type: "tokens", count: totalTokens });
    }

    // If no assistant IR was added but we have streaming content, add it
    const hasAssistantIr = finish.irs.some(ir => ir.role === "assistant");
    if (!hasAssistantIr && assistantContent) {
      messages.push({
        role: "assistant",
        content: assistantContent,
        tokenUsage: 0,
        outputTokens: 0,
      } as LlmIR);
    }

    // Check the finish reason
    if (finish.reason.type === "needs-response") {
      // The agent has completed its response - we're done
      break;
    } else if (finish.reason.type === "request-tool") {
      // The agent wants to use a tool - execute it and continue
      const toolCall = finish.reason.toolCall;

      // Report tool usage
      reportProgress({ type: "using_tool", toolName: toolCall.function.name, increment: true });

      try {
        // Execute the tool
        const toolResult = await runTool(
          abortSignal,
          transport,
          filteredTools,
          toolCall.function,
          config,
          null,
        );

        // Add the tool result to messages
        messages.push({
          role: "tool-output",
          content: toolResult.content,
          toolCall,
        } as unknown as LlmIR);
      } catch (error) {
        // Tool execution failed - add error to messages
        const errorMessage = error instanceof Error ? error.message : String(error);
        messages.push({
          role: "tool-error",
          error: errorMessage,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.function.name,
        } as unknown as LlmIR);
      }

      // Continue the conversation with the tool result
      continue;
    } else if (finish.reason.type === "abort") {
      // Aborted - return empty
      return { content: "" };
    } else if (finish.reason.type === "request-error") {
      // Request error - return the error message
      return { content: `Error: ${finish.reason.requestError}` };
    }

    // Unknown finish reason - break to avoid infinite loop
    break;
  }

  // Extract the final content from the last assistant response
  let finalContent = "";

  // First, try to find the last assistant message in the conversation
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.content) {
      finalContent = msg.content;
      break;
    }
  }

  // Report completion to task store
  if (taskId) {
    useTaskStore.getState().completeTask(taskId, finalContent);
  }
  reportProgress({ type: "completed" });

  return { content: finalContent };
}
