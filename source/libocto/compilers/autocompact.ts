import type { Agent, Content, LoweredIR } from "../llm-ir.ts";
import type { ToolMap } from "../tool-def.ts";
import type {
  CompilerError,
  CompilerIR,
  CompilerResultWithoutToolCalls,
} from "./compiler-interface.ts";
import { Result, ok, err } from "../result.ts";

const AUTOCOMPACT_THRESHOLD = 0.9;

export type CompactionError =
  | {
      type: "compaction-error";
      requestError: string;
      curl: string | null;
    }
  | Extract<CompilerError, { type: "payment-error" | "rate-limit-error" }>;

const COMPACTION_CHECKPOINT_PREFIX = `# Conversation History Summary

The following text is a condensed summary of all previous messages in this conversation:

`;

const COMPACTION_CHECKPOINT_SUFFIX = `

---

## IMPORTANT: Context Has Been Compacted

The individual messages from earlier in this conversation are no longer available. They have been compressed into the summary text above to save tokens.

**Your instructions:**
1. Read the summary text above - it contains all the information from the previous messages
2. Treat the summary as your complete reference for what happened earlier in this conversation
3. Continue working on your current task exactly where you left off

Resume your work now.`;

export function shouldAutoCompactHistory<T extends ToolMap<any, any>>(
  maxContextWindow: number,
  messages: Array<LoweredIR<T>>,
): boolean {
  const maxAllowedTokens = Math.floor(maxContextWindow * AUTOCOMPACT_THRESHOLD);
  const currentTokens = approximateIRTokens(messages);

  return currentTokens >= maxAllowedTokens;
}

export async function generateCompactionCheckpointContent<A extends Agent<any, any, any>>({
  messages,
  run,
}: {
  messages: Array<CompilerIR<A>>;
  run: (messages: Array<CompilerIR<A>>) => Promise<CompilerResultWithoutToolCalls<A>>;
}): Promise<Result<Content["content"] | null, CompactionError>> {
  const summaryMessages: Array<CompilerIR<A>> = [
    ...messages,
    {
      role: "user",
      content: [{ type: "text", content: compactPrompt() }],
    },
  ];

  const compactRunResult = await run(summaryMessages);

  if (!compactRunResult.success) {
    if (isRecoverableRequestError(compactRunResult.error)) return err(compactRunResult.error);

    return err({
      type: "compaction-error",
      requestError: compactRunResult.error.requestError,
      curl: compactRunResult.error.curl,
    });
  }

  const summary = processCompactedHistory(compactRunResult);
  if (summary == null || summary === "") {
    return err({
      type: "compaction-error",
      requestError: "Compaction result was empty, continuing without compacting messages.",
      curl: null,
    });
  }
  return ok([
    { type: "text", content: COMPACTION_CHECKPOINT_PREFIX },
    { type: "text", content: summary },
    { type: "text", content: COMPACTION_CHECKPOINT_SUFFIX },
  ]);
}

export function processCompactedHistory<A extends Agent<any, any, any>>(
  compactSummaryResult: CompilerResultWithoutToolCalls<A>,
): string | undefined {
  if (!compactSummaryResult.success) {
    return;
  }
  const assistantMessage = compactSummaryResult.data.output;

  if (assistantMessage.content) {
    return assistantMessage.content;
  }

  if (assistantMessage.reasoningContent) {
    return assistantMessage.reasoningContent;
  }

  return undefined;
}

function isRecoverableRequestError(
  error: CompilerError,
): error is Extract<CompilerError, { type: "payment-error" | "rate-limit-error" }> {
  return error.type === "payment-error" || error.type === "rate-limit-error";
}

function approximateIRTokens<T extends ToolMap<any, any>>(ir: Array<LoweredIR<T>>): number {
  let mostRecentAssistantIndex = -1;
  for (let i = ir.length - 1; i >= 0; i--) {
    if (ir[i].role === "assistant") {
      mostRecentAssistantIndex = i;
      break;
    }
  }

  const checkpointTokenCount =
    mostRecentAssistantIndex === -1
      ? 0
      : (() => {
          const assistant = ir[mostRecentAssistantIndex];
          if (assistant.role !== "assistant") return 0;
          return assistant.usage.input.total + assistant.usage.output;
        })();

  let trailingTokenCount = 0;
  for (let i = mostRecentAssistantIndex + 1; i < ir.length; i++) {
    trailingTokenCount += estimateTokens(messageText(ir[i]));
  }

  return checkpointTokenCount + trailingTokenCount;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageText<T extends ToolMap<any, any>>(msg: LoweredIR<T>): string {
  switch (msg.role) {
    case "assistant":
      return (msg.content ?? "") + (msg.reasoningContent ?? "");
    case "user":
    case "tool-output":
    case "lowered-checkpoint":
      return contentText(msg.content);
    case "tool-runtime-error":
    case "tool-validation-error":
      return msg.error;
    case "tool-parse-error":
      return (msg.malformedRequest.call.original.arguments ?? "") + msg.malformedRequest.error;
    case "tool-skip-output":
      return msg.reason;
  }
}

function contentText(content: Content["content"]): string {
  return content
    .map(part => {
      if (part.type === "text") return part.content;
      return `Image file: ${part.image.filePath}`;
    })
    .join("\n");
}

function compactPrompt() {
  return `Generate a summary of everything you've talked about and done in this conversation.

You are creating an internal context summary that will replace previous messages in the conversation history.

**IMPORTANT**: You are NOT continuing the conversation or responding to the user. You are creating a factual record of what has already happened. The user will likely never see this summary - it exists only to preserve context when the conversation resumes.

**Your task**: Analyze the conversation history that you read at the beginning of this message and create a detailed technical summary capturing all essential information for continuing work.

Before writing your summary, use <analysis> tags to organize your thinking:

<analysis>
[Chronologically review each part of the conversation and identify:
- The user's explicit requests and goals
- Actions that were taken and their outcomes
- Technical decisions and their rationale
- Important code changes, file modifications, and command outputs
- Problems encountered and their resolutions
- Work that remains incomplete]
</analysis>

Then provide your summary in this structure:

<summary>
## Primary Request
[What the user asked for, in their own words if possible]

## Work Completed
[Specific actions taken, files modified, commands run - with results]

## Technical Context
- Architecture decisions made and why
- Patterns, frameworks, libraries being used (with examples)
- Commands that worked (exact syntax + relevant output)
- Commands that failed (what was tried, error messages, why it failed)
- Environment details (versions, dependencies, system info)

## Files Modified
For each file:
- **[Filename]**: [Why it's relevant] [What changed] [Current state]

## Work In Progress
[Specific description of incomplete work - which files, what state they're in, what was being attempted]

## Outstanding Issues
- Errors not yet resolved (include error messages)
- User requests acknowledged but not completed
- Known blockers or risks

## Context for Resuming
[The most important things to know to pick up where this left off - reference specific files, line numbers, or error states]
</summary>

**Formatting rules**:
- Write in past tense ("The user requested...", "The assistant modified...", "The build failed...")
- Be specific: include file paths, function names, exact error messages, command syntax
- Capture enough detail that work could resume without re-reading the full history
- This is technical documentation, not a conversation
`;
}
