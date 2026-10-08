import { readAuthForModel, type Config, type ModelConfig } from "./config.ts";
import type { Compiler } from "./libocto/compilers/compiler-interface.ts";
import { messageText } from "./libocto/llm-ir.ts";
import { err, ok, type Result } from "./libocto/result.ts";
import {
  DEFAULT_MAX_TOOL_OUTPUT_FRACTION,
  type TrajectoryModelError,
  type TrajectoryParams,
} from "./libocto/trajectory.ts";
import type { Transport } from "./transports/transport-common.ts";
import { run, type ModelData } from "./compilers/run.ts";
import { lowerOcto } from "./compilers/lower-octo.ts";
import { autofixEdit, makeAutofixJson } from "./compilers/autofix.ts";
import { systemPrompt } from "./prompts/system-prompt.ts";
import { loadTools } from "./tools/index.ts";
import { estimateTokens } from "./ir/count-ir-tokens.ts";
import { octoAgent } from "./ir/octo-ir.ts";

export const MAX_RETRY_COUNT = 20;

// Tool outputs rejected by maxToolOutput start with this prefix; headless clients can match on
// it to report truncated output without depending on the full wording.
export const TOOL_OUTPUT_TOO_LARGE_PREFIX = "Tool output was too large";

const PREVIEW_CHARS = 200;

export type OctoTrajectoryEnv = {
  // Bound at construction time: the interactive store can't call getConfig() until the session
  // is live, but tool data and error correction only need the boot-time config.
  config: Config;
  getConfig: () => Config;
  getModel: () => ModelConfig;
  transport: Transport;
  runCompiler?: Compiler<ModelData>;
};

/*
 * The store-independent parameters for an octo Trajectory: everything the interactive store
 * (state.ts) and the headless driver (cli/headless-run.ts) agree on. Clients supply messages,
 * the abort signal, the permission gate, and the event handler themselves.
 */
export type SharedOctoTrajectoryParams = Omit<
  TrajectoryParams<typeof octoAgent, ModelData>,
  "messages" | "abortSignal" | "handler" | "permission"
>;

export function octoSharedTrajectoryParams(env: OctoTrajectoryEnv): SharedOctoTrajectoryParams {
  const { getConfig, getModel, transport } = env;
  return {
    agent: octoAgent,
    systemPrompt: signal => systemPrompt({ config: getConfig(), transport, signal }),
    model: async (): Promise<
      Result<{ model: ModelData; contextWindow: number }, TrajectoryModelError>
    > => {
      const model = getModel();
      if (model.type === "codex") {
        const authResult = await readAuthForModel(model, getConfig());
        if (!authResult.ok) {
          return err({ type: "auth-error", authError: authResult.error.message });
        }
        return ok({
          model: { type: "codex", auth: authResult.auth, model },
          contextWindow: model.context,
        });
      }
      const authResult = await readAuthForModel(model, getConfig());
      if (!authResult.ok) {
        return err({ type: "auth-error", authError: authResult.error.message });
      }
      return ok({
        model: { type: "api", auth: authResult.auth, model },
        contextWindow: model.context,
      });
    },
    loadTools: signal => loadTools(transport, signal, getConfig()),
    countTokens: irs => irs.reduce((tokens, ir) => tokens + estimateTokens(messageText(ir)), 0),
    toolContentTooLargeError: async ir => {
      let text = "";
      if (ir.role === "tool-output") {
        for (const part of ir.content) {
          if (part.type === "text") text += part.content;
        }
      } else if (ir.role === "file-read" || ir.role === "file-mutate") {
        text = ir.content;
      }
      const model = getModel();
      const tokens = estimateTokens(text);
      const preview = text.slice(0, PREVIEW_CHARS);
      return (
        `${TOOL_OUTPUT_TOO_LARGE_PREFIX}: approximately ${tokens} tokens, which is ` +
        `${DEFAULT_MAX_TOOL_OUTPUT_FRACTION * 100}% or more of the model's ` +
        `${model.context}-token context window. The output was discarded to protect the ` +
        `context window. Retry with a more targeted approach: page through the file with ` +
        `partial-read using offset/limit, narrow searches with tighter patterns or ` +
        `maxResults, or limit shell output (e.g. pipe through head/tail/grep). Before it ` +
        `was discarded, the first ${PREVIEW_CHARS} characters were preserved so you can ` +
        `inspect them; here they are:\n${preview}`
      );
    },
    toolData: env.config,
    runCompiler: env.runCompiler ?? (run as Compiler<ModelData>),
    lowerMessages: messages => lowerOcto(messages, getModel().modalities),
    transport,
    errorCorrection: {
      json: makeAutofixJson(env.config),
      tools: {
        edit: async ({ toolCall, abortSignal: fixSignal, transport: fixTransport }) => {
          const file = await fixTransport.readFile(fixSignal, toolCall.parsed.filePath);
          const fix = await autofixEdit(env.config, file, toolCall.parsed, fixSignal);
          if (fix == null) return null;
          return { ...toolCall.parsed, ...fix };
        },
      },
    },
    requestErrorRetries: {
      maxRetryCount: MAX_RETRY_COUNT,
      backoffMs: 2000,
      maxBackoffMs: 30_000,
    },
  };
}
