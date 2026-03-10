import OpenAI from "openai";
import { APP_METADATA } from "../config.ts";

export function getDefaultOpenaiClient({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }) {
  return new OpenAI({
    baseURL: baseUrl,
    apiKey,
    defaultHeaders: {
      "User-Agent": `octofriend/${APP_METADATA.version}`,
    },
  });
}
