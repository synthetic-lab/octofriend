import type { Transport } from "./transport.ts";

export type ExecutionModel = {
  contextWindow: number;
};

export type ExecutionArgs<Data> = {
  signal: AbortSignal;
  transport: Transport;
  model: ExecutionModel;
  data: Data;
};
