import OpenAI from "openai";
import type { Agent } from "../llm-ir.ts";
import type { LoadedTools } from "../tool-def.ts";
import type {
  Compiler,
  CompilerModalities,
  CompilerParams,
  CompilerResult,
} from "./compiler-interface.ts";
import { runResponsesAgent } from "./responses.ts";
import type { OpenAICompilerModel } from "./openai-shared.ts";
import { fetchDeps } from "../../fetch.ts";

export const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex";

export type CodexCompilerAuth = {
  access: string;
  accountId?: string;
};

export type CodexCompilerModel = {
  model: string;
  auth: () => Promise<CodexCompilerAuth>;
  baseURL?: string;
  modalities?: CompilerModalities;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  originator?: string;
  userAgent?: string;
  sessionId?: string;
};

export async function runCodexAgent<
  A extends Agent<any, any, any>,
  Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
>(params: CompilerParams<A, CodexCompilerModel, Tools>): Promise<CompilerResult<A, Tools>> {
  return runResponsesAgent<A, Tools>({
    ...params,
    model: codexOpenAICompilerModel(params.model),
  });
}

runCodexAgent satisfies Compiler<CodexCompilerModel>;

export function codexOpenAICompilerModel(model: CodexCompilerModel): OpenAICompilerModel {
  return {
    client: createCodexOpenAIClient(model),
    model: model.model,
    modalities: model.modalities,
    reasoningEffort: model.reasoningEffort,
  };
}

export function createCodexOpenAIClient(model: CodexCompilerModel): OpenAI {
  return new OpenAI({
    baseURL: model.baseURL ?? CODEX_API_BASE_URL,
    apiKey: "codex",
    defaultHeaders: {
      originator: model.originator ?? "octofriend",
      ...(model.userAgent ? { "User-Agent": model.userAgent } : {}),
      ...(model.sessionId ? { "session-id": model.sessionId } : {}),
    },
    fetch: async (input, init) => {
      const auth = await model.auth();
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${auth.access}`);
      if (auth.accountId) headers.set("ChatGPT-Account-Id", auth.accountId);
      return fetchDeps.fetch(input, { ...init, headers });
    },
  });
}
