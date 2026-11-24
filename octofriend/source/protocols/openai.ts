import OpenAI from "openai";
import { APP_METADATA } from "../config.ts";
import { fetchDeps } from "../fetch.ts";

export const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex";

export function getDefaultOpenaiClient({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }) {
  return new OpenAI({
    baseURL: baseUrl,
    apiKey,
    defaultHeaders: {
      "User-Agent": `octofriend/${APP_METADATA.version}`,
    },
  });
}

export function getCodexOpenaiClient({
  oauthToken,
  accountId,
}: {
  oauthToken: string;
  accountId?: string;
}) {
  return new OpenAI({
    baseURL: CODEX_API_BASE_URL,
    apiKey: "codex",
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${oauthToken}`);
      if (accountId) headers.set("ChatGPT-Account-Id", accountId);
      return fetchDeps.fetch(input, { ...init, headers });
    },
  });
}
