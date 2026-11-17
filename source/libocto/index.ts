/*
 * libocto's public surface. Clients import the agent framework from here and toolkit APIs from
 * ./toolkits/index.ts, so libocto's internal file layout stays private:
 *
 *   import { Protocol, Trajectory, agent, prompt } from "../libocto/index.ts";
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

// The protocol contract.
export * from "./protocols/protocol-interface.ts";
export { imageAttachmentPlaceholderText } from "./protocols/ir-prompts.ts";

/*
 * Compilers: IR in, a complete provider-native request body out, no execution. Use these to run
 * requests on your own transport — enqueue them for a cloud worker, or emit them as SFT data.
 */
export {
  chatCompletionsCompiler,
  chatCompletionsCurl,
} from "./protocols/chat-completions/compiler-chat-completions.ts";
export {
  anthropicCompiler,
  anthropicCurl,
  type AnthropicCompileConfig,
} from "./protocols/anthropic/compiler-anthropic.ts";
export { responsesCompiler, responsesCurl } from "./protocols/responses/compiler-responses.ts";
export type {
  OpenAIBackend,
  OpenAICompileConfig,
  OpenAIReasoningEffort,
} from "./protocols/openai-shared.ts";

// Protocols: compile, execute against the provider, and interpret the stream back into IR.
export { chatCompletionsProtocol } from "./protocols/chat-completions/protocol-chat-completions.ts";
export type { AnthropicBackend } from "./protocols/anthropic/protocol-anthropic.ts";
export { anthropicProtocol } from "./protocols/anthropic/protocol-anthropic.ts";
export { responsesProtocol } from "./protocols/responses/protocol-responses.ts";

export * as toolkits from "./toolkits/index.ts";
