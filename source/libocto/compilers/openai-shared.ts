import type OpenAI from "openai";
import type { CompilerModalities } from "./compiler-interface.ts";

export type OpenAICompilerModel = {
  client: OpenAI;
  model: string;
  modalities?: CompilerModalities;
  reasoningEffort?: "low" | "medium" | "high";
};
