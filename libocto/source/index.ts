/*
 * libocto's public surface. Clients don't depend on the SDK's internal layout:
 *
 *   import { protocols, Trajectory, agent, prompt, toolkits } from "libocto";
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
export { BackgroundProcessManager, type BackgroundProcess } from "./background-process.ts";

export * as protocols from "./protocols/index.ts";

export * as toolkits from "./toolkits/index.ts";
