import React, { createContext } from "react";
import { LocalTransport } from "./transports/local.ts";
import { Transport } from "./transports/transport-common.ts";

export const TransportContext = createContext<Transport>(new LocalTransport());
