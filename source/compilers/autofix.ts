import OpenAI from "openai";
import { t } from "structural";
import { Config } from "../config.ts";
import * as toolMap from "../tools/tool-defs/index.ts";
import { fixEditPrompt, fixJsonPrompt, JsonFixResponse, DiffApplyResponse } from "../autofix-prompts.ts";
import { trackTokens } from "../token-tracker.ts";

type DiffEdit = t.GetType<typeof toolMap.edit.DiffEdit>;
export async function autofixEdit(
  config: Config,
  file: string,
  edit: DiffEdit,
  abortSignal: AbortSignal,
): Promise<DiffEdit | null> {
  const result = await autofix(config.diffApply, fixEditPrompt({ file, edit }), abortSignal);
  if(result == null) return null;
  try {
    const parsed = JSON.parse(result);
    if(parsed == null) return null;
    const sliced = DiffApplyResponse.slice(parsed);
    if(!sliced.success) return null;
    return {
      type: "diff",
      search: sliced.search,
      replace: edit.replace,
    };
  } catch {
    return null;
  }
}

export async function autofixJson(config: Config, brokenJson: string) {
  const result = await autofix(config.fixJson, fixJsonPrompt(brokenJson));
  if(result == null) return { success: false as const };
  try {
    const json = JSON.parse(result);
    const response = JsonFixResponse.slice(json);
    if(response.success) return response;
    return { success: false as const };
  } catch {
    return { success: false as const };
  }
}

async function autofix(
  config: { baseUrl: string, apiEnvVar: string, model: string } | null | undefined,
  message: string,
  abortSignal?: AbortSignal,
): Promise<string | null> {
  if(config == null) return null;

  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: process.env[config.apiEnvVar],
  });
  const model = config.model;
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
    response_format: {
      type: "json_object",
    },
  }, abortSignal ? { signal: abortSignal } : undefined);

  if(response.usage) {
    trackTokens(model, "input", response.usage.prompt_tokens);
    trackTokens(model, "output", response.usage.completion_tokens);
  }

  const result = response.choices[0].message.content;
  if(result == null) return null;
  return result;
}
