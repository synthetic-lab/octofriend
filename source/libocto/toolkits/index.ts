/*
 * Every toolkit libocto ships, keyed by name. Each toolkit owns its own surface, so clients read
 * straight through it:
 *
 *   agent.use(toolkits.explore.toolkit)
 *   toolkits.edit.ArgumentsSchema
 *   toolkits.skill.discoverSkills(...)
 *
 * Adding an export to a toolkit never needs a matching change here, and two toolkits may use the
 * same internal names without colliding.
 */
export * as backgroundProcess from "./background-process/index.ts";
export * as create from "./create/index.ts";
export * as edit from "./edit/index.ts";
export * as explore from "./explore/index.ts";
export * as fetch from "./fetch/index.ts";
export * as glob from "./glob/index.ts";
export * as grep from "./grep/index.ts";
export * as list from "./list/index.ts";
export * as lspDefinition from "./lsp-definition/index.ts";
export * as lspDiagnostics from "./lsp-diagnostics/index.ts";
export * as lspDocumentSymbol from "./lsp-document-symbol/index.ts";
export * as lspHover from "./lsp-hover/index.ts";
export * as lspImplementation from "./lsp-implementation/index.ts";
export * as lspIncomingCalls from "./lsp-incoming-calls/index.ts";
export * as lspOutgoingCalls from "./lsp-outgoing-calls/index.ts";
export * as lspReferences from "./lsp-references/index.ts";
export * as manageBackgroundProcess from "./manage-background-process/index.ts";
export * as mcp from "./mcp/index.ts";
export * as partialRead from "./partial-read/index.ts";
export * as read from "./read/index.ts";
export * as rewrite from "./rewrite/index.ts";
export * as shell from "./shell/index.ts";
export * as skill from "./skill/index.ts";
export * as webResearch from "./web-research/index.ts";
export * as webSearch from "./web-search/index.ts";

// Toolkit authoring, plus the pieces no single toolkit owns: the file tools share an untracked
// read, and the lsp toolkits share one client pool.
export * from "./tool-def.ts";
export { attemptUntrackedRead } from "./common.ts";
export { shutdownLspClients } from "../lsp/client.ts";
export type { LspToolData } from "../lsp/detect.ts";
