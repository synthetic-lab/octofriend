import { createContext, useContext } from "react";
import type { Transport } from "../internal/transport/common.ts";
import { LocalTransport } from "../internal/transport/local.ts";

export const TransportContext = createContext<Transport>(new LocalTransport());

export function useTransport(): Transport {
	return useContext(TransportContext);
}
