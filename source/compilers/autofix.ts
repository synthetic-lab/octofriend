import OpenAI from "openai";
import { t } from "structural";
import { Config, assertKeyForModel } from "../config.ts";
import { ArgumentsSchema as EditSchema } from "../tools/tool-defs/edit.ts";
import {
  fixEditPrompt, fixJsonPrompt, JsonFixResponseSchema, DiffApplyResponse
} from "../prompts/autofix-prompts.ts";
import { trackTokens } from "../token-tracker.ts";

type Edit = t.GetType<typeof EditSchema>;
export async function autofixEdit(
  config: Config,
  file: string,
  edit: Edit,
  abortSignal: AbortSignal,
): Promise<Edit | null> {
  const result = await autofix(config.diffApply, config, fixEditPrompt({ file, edit }), abortSignal);
  if(result == null) return null;
  try {
    const parsed = JSON.parse(result);
    if(parsed == null) return null;
    const sliced = DiffApplyResponse.slice(parsed);
    if(!sliced.success) return null;
    return {
      ...edit,
      search: sliced.search,
      replace: edit.replace,
    };
  } catch {
    return null;
  }
}

export async function autofixJson(config: Config, brokenJson: string, abortSignal: AbortSignal) {
  const result = await autofix(config.fixJson, config, fixJsonPrompt(brokenJson), abortSignal);
  if(result == null) return { success: false as const };
  try {
    const json = JSON.parse(result);
    const response = JsonFixResponseSchema.slice(json);
    if(response.success) return response;
    return { success: false as const };
  } catch {
    return { success: false as const };
  }
}

// Makes a curried autofixJson function that doesn't require passing in the config; useful for
// calling the main run(...) compiler
export function makeAutofixJson(config: Config) {
  return async (brokenJson: string, abortSignal: AbortSignal) => {
    return autofixJson(config, brokenJson, abortSignal);
  };
}

async function autofix(
  modelConf: { baseUrl: string, apiEnvVar?: string, model: string } | null | undefined,
  config: Config,
  message: string,
  abortSignal: AbortSignal,
): Promise<string | null> {
  if(modelConf == null) return null;

  const apiKey = await assertKeyForModel({ baseUrl: modelConf.baseUrl }, config);
  const client = new OpenAI({
    baseURL: modelConf.baseUrl,
    apiKey,
  });
  const model = modelConf.model;
  try {
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
  } catch {
    return null;
  }
}
