import { t } from "structural";
import type OpenAI from "openai";
import type { CompilerError, CompilerModalities } from "./compiler-interface.ts";
import { errorToString } from "../result.ts";

export type OpenAICompilerModel = {
  client: OpenAI;
  model: string;
  modalities?: CompilerModalities;
  reasoningEffort?: "low" | "medium" | "high";
};

const OpenAIStatusErrorSchema = t.subtype({
  status: t.num,
  headers: t.optional(t.instanceOf(Headers)),
  error: t.optional(
    t.str.or(
      t.subtype({
        message: t.optional(t.str),
      }),
    ),
  ),
});

export function openAIRequestError(curl: string, error: unknown): CompilerError {
  const parsed = OpenAIStatusErrorSchema.sliceResult(error);
  if (parsed instanceof t.Err) {
    return {
      type: "request-error",
      requestError: errorToString(error),
      curl,
    };
  }

  if ((parsed.status !== 402 && parsed.status !== 429) || !parsed.headers) {
    return {
      type: "request-error",
      requestError: errorToString(error),
      curl,
      headers: parsed.headers,
    };
  }

  return {
    type: parsed.status === 402 ? "payment-error" : "rate-limit-error",
    requestError: errorMessage(parsed, error),
    curl,
    headers: parsed.headers,
  };
}

function errorMessage(parsed: t.GetType<typeof OpenAIStatusErrorSchema>, error: unknown): string {
  if (typeof parsed.error === "string") return parsed.error;
  if (parsed.error?.message) return parsed.error.message;
  if (error instanceof Error) return error.message;
  return "OpenAI request failed";
}
