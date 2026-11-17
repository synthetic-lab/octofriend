/*
 * libocto's public surface. Clients import the agent framework from here and toolkit APIs from
 * ./toolkits/index.ts, so libocto's internal file layout stays private:
 *
 *   import { Interpreter, Trajectory, agent, prompt } from "../libocto/index.ts";
 *   import { toolkits } from "../libocto/index.ts";
 */
export * from "./llm-ir.ts";
export * from "./result.ts";
export * from "./transport.ts";
export * from "./trajectory.ts";
export * from "./execution.ts";
export * from "./images.ts";
export * from "./logger.ts";
export * from "./modalities.ts";
export * from "./permissions.ts";
export * from "./system-prompt.ts";
export { lowerMessages, meaningfulTailIR } from "./ir-operations.ts";
export { timeout } from "./signals.ts";
export { BackgroundProcessManager } from "./background-process.ts";

// The jit contract.
export * from "./jit/jit-interface.ts";
export { imageAttachmentPlaceholderText } from "./jit/ir-prompts.ts";

/*
 * Compilers: IR in, a complete provider-native request body out, no execution. Use these to run
 * requests on your own transport — enqueue them for a cloud worker, or emit them as SFT data.
 */
export {
  chatCompletionsCompiler,
  chatCompletionsCurl,
} from "./jit/chat-completions/compiler-chat-completions.ts";
export {
  anthropicCompiler,
  anthropicCurl,
  type AnthropicCompileConfig,
} from "./jit/anthropic/compiler-anthropic.ts";
export { responsesCompiler, responsesCurl } from "./jit/responses/compiler-responses.ts";
export type {
  OpenAIBackend,
  OpenAICompileConfig,
  OpenAIReasoningEffort,
} from "./jit/openai-shared.ts";

// Interpreters: compile, execute against the provider, and interpret the stream back into IR.
export { runChatCompletionsAgent } from "./jit/chat-completions/interpreter-chat-completions.ts";
export type { AnthropicBackend } from "./jit/anthropic/interpreter-anthropic.ts";
export { runAnthropicAgent } from "./jit/anthropic/interpreter-anthropic.ts";
export { runResponsesAgent } from "./jit/responses/interpreter-responses.ts";

export * as toolkits from "./toolkits/index.ts";
