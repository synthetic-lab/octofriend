import { createContext, useContext } from "react";
import { Transport } from "./libocto/transport.ts";
import { LocalTransport } from "./transports/local.ts";

export const TransportContext = createContext<Transport>(new LocalTransport());

export function useTransport(): Transport {
  return useContext(TransportContext);
}
