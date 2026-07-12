import { createContext, useContext } from "react";
import type { Transport } from "../runtime/workspace/common.ts";
import { LocalTransport } from "../runtime/workspace/local.ts";

export const TransportContext = createContext<Transport>(new LocalTransport());

export function useTransport(): Transport {
	return useContext(TransportContext);
}
