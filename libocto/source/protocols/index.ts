export * as chatCompletions from "./chat-completions/index.ts";
export * as responses from "./responses/index.ts";
export * as anthropic from "./anthropic/index.ts";

export * from "./protocol-interface.ts";
export type { OpenAIBackend, OpenAICompileConfig, OpenAIReasoningEffort } from "./openai-shared.ts";
export type { AnthropicBackend } from "./anthropic/run-anthropic.ts";
export type { AnthropicCompileConfig } from "./anthropic/compiler-anthropic.ts";
export { imageAttachmentPlaceholderText } from "./ir-prompts.ts";
