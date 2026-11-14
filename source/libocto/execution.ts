import type { Transport } from "./transport.ts";

export type ExecutionArgs<Data> = {
  signal: AbortSignal;
  transport: Transport;
  data: Data;
};
