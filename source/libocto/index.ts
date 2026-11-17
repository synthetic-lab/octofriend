/*
 * libocto's public surface. Clients import the agent framework from here and toolkit APIs from
 * ./toolkits/index.ts, so libocto's internal file layout stays private:
 *
 *   import { protocols, Trajectory, agent, prompt } from "../libocto/index.ts";
 *   import { toolkits } from "../libocto/index.ts";
 */
export * from "./llm-ir.ts";
export * from "./result.ts";
export * from "./transport.ts";
export * from "./trajectory.ts";
export * from "./execution.ts";
export * from "./images.ts";
export * from "./logger.ts";
export * from "./modalities.ts";
export * from "./permissions.ts";
export * from "./system-prompt.ts";
export { lowerMessages, meaningfulTailIR } from "./ir-operations.ts";
export { timeout } from "./signals.ts";
export { BackgroundProcessManager } from "./background-process.ts";

export * as protocols from "./protocols/index.ts";

export * as toolkits from "./toolkits/index.ts";
