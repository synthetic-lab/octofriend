import type { MultimodalConfig } from "./modalities.ts";
import type { Transport } from "./transport.ts";
import { messageText, type LoweredIR } from "./llm-ir.ts";

export type ExecutionModel<Provider> = {
  provider: Provider;
  model: string;
  contextWindow: number;
  modalities: MultimodalConfig | null;
  countTokens: (irs: Array<LoweredIR<any>>) => Promise<number>;
};

// ~4 characters per token for English text:
// https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
export async function defaultCountTokens(irs: Array<LoweredIR<any>>): Promise<number> {
  let text = "";
  for (const ir of irs) text += messageText(ir);
  return Math.ceil(text.length / 4);
}

export type ExecutionArgs<Data, Provider> = {
  signal: AbortSignal;
  transport: Transport;
  model: ExecutionModel<Provider>;
  data: Data;
};
