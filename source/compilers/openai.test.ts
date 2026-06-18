import { describe, expect, it, vi } from "vitest";
import { withMock } from "antipattern";
import { runResponsesAgent } from "../libocto/compilers/responses.ts";
import { octoAgent } from "../ir/octo-ir.ts";
import type { Transport } from "../transports/transport-common.ts";
import { CODEX_API_BASE_URL, getCodexOpenaiClient } from "./openai.ts";
import { fetchDeps } from "../fetch.ts";
import type { CompilerResultWithoutToolCalls } from "../libocto/compilers/compiler-interface.ts";

function sse(...events: unknown[]): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
}

describe("getCodexOpenaiClient", () => {
  it("sends Responses requests to the Codex backend with Codex auth headers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response(
        sse({
          type: "response.completed",
          sequence_number: 0,
          response: {
            output: [],
            usage: {
              input_tokens: 2,
              input_tokens_details: { cached_tokens: 1 },
              output_tokens: 3,
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "x-test-header": "present",
          },
        },
      );
    });

    let result: CompilerResultWithoutToolCalls<typeof octoAgent> | undefined;
    await withMock(fetchDeps, "fetch", fetch, async () => {
      result = await runResponsesAgent<typeof octoAgent>({
        model: {
          client: getCodexOpenaiClient({
            oauthToken: "access-token",
            accountId: "account-1",
          }),
          model: "gpt-5.5",
        },
        irs: [
          {
            role: "user",
            content: [{ type: "text", content: "hello" }],
          },
        ],
        onTokens: () => {},
        abortSignal: new AbortController().signal,
        transport: fakeTransport(),
      });
    });

    if (!result) throw new Error("Responses compiler did not return a result");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.usage).toEqual({
      input: { cached: 1, uncached: 1, total: 2 },
      output: 3,
    });
    expect(result.data.headers.get("x-test-header")).toBe("present");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`${CODEX_API_BASE_URL}/responses`);
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token");
    expect(headers.get("ChatGPT-Account-Id")).toBe("account-1");
    expect(headers.get("originator")).toBeNull();
    expect(headers.get("session-id")).toBeNull();
  });
});

function fakeTransport(): Transport {
  return {
    cwd: ".",
    writeFile: async () => {},
    readFile: async () => "",
    pathExists: async () => false,
    isDirectory: async () => false,
    mkdir: async () => {},
    readdir: async () => [],
    modTime: async () => 0,
    resolvePath: async (_signal, path) => path,
    shell: async () => "",
    close: async () => {},
  };
}
