import { agent, toolkits, type AgentIR } from "../libocto/index.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";

export const octoAgent = agent
  .use(toolkits.explore.toolkit)
  .use(toolkits.webResearch.toolkit)
  .definePermissioned({
    systemPrompt,
    tools: {
      read: toolkits.read.toolkit,
      "partial-read": toolkits.partialRead.toolkit,
      list: toolkits.list.toolkit,
      shell: toolkits.shell.toolkit,
      edit: toolkits.edit.toolkit,
      create: toolkits.create.toolkit,
      mcp: toolkits.mcp.toolkit,
      rewrite: toolkits.rewrite.toolkit,
      skill: toolkits.skill.toolkit,
      "background-process": toolkits.backgroundProcess.toolkit,
      "manage-background-process": toolkits.manageBackgroundProcess.toolkit,
      glob: toolkits.glob.toolkit,
      grep: toolkits.grep.toolkit,
      "lsp-definition": toolkits.lspDefinition.toolkit,
      "lsp-references": toolkits.lspReferences.toolkit,
      "lsp-hover": toolkits.lspHover.toolkit,
      "lsp-diagnostics": toolkits.lspDiagnostics.toolkit,
      "lsp-document-symbol": toolkits.lspDocumentSymbol.toolkit,
      "lsp-implementation": toolkits.lspImplementation.toolkit,
      "lsp-incoming-calls": toolkits.lspIncomingCalls.toolkit,
      "lsp-outgoing-calls": toolkits.lspOutgoingCalls.toolkit,
    },
    agents: {},
  });

export type OctoIR = AgentIR<typeof octoAgent>;
