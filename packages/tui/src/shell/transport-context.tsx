import { createContext, useContext } from "react";
import type { Transport } from "../runtime/workspace/common";
import { LocalTransport } from "../runtime/workspace/local";

export const TransportContext = createContext<Transport>(new LocalTransport());

export function useTransport(): Transport {
	return useContext(TransportContext);
}
