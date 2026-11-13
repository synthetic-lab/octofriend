import { agent } from "../libocto/llm-ir.ts";
import type { AgentIR } from "../libocto/llm-ir.ts";
import backgroundProcess from "../libocto/toolkits/background-process/index.ts";
import create from "../libocto/toolkits/create/index.ts";
import edit from "../libocto/toolkits/edit/index.ts";
import { explore } from "../libocto/toolkits/explore/index.ts";
import glob from "../libocto/toolkits/glob/index.ts";
import grep from "../libocto/toolkits/grep/index.ts";
import list from "../libocto/toolkits/list/index.ts";
import lspDefinition from "../libocto/toolkits/lsp-definition/index.ts";
import lspDiagnostics from "../libocto/toolkits/lsp-diagnostics/index.ts";
import lspDocumentSymbol from "../libocto/toolkits/lsp-document-symbol/index.ts";
import lspHover from "../libocto/toolkits/lsp-hover/index.ts";
import lspImplementation from "../libocto/toolkits/lsp-implementation/index.ts";
import lspIncomingCalls from "../libocto/toolkits/lsp-incoming-calls/index.ts";
import lspOutgoingCalls from "../libocto/toolkits/lsp-outgoing-calls/index.ts";
import lspReferences from "../libocto/toolkits/lsp-references/index.ts";
import manageBackgroundProcess from "../libocto/toolkits/manage-background-process/index.ts";
import mcp from "../libocto/toolkits/mcp/index.ts";
import partialRead from "../libocto/toolkits/partial-read/index.ts";
import read from "../libocto/toolkits/read/index.ts";
import rewrite from "../libocto/toolkits/rewrite/index.ts";
import shell from "../libocto/toolkits/shell/index.ts";
import skill from "../libocto/toolkits/skill/index.ts";
import { webResearch } from "../libocto/toolkits/web-research/index.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";

export const octoAgent = agent
  .use(explore)
  .use(webResearch)
  .definePermissioned({
    systemPrompt,
    tools: {
      read,
      "partial-read": partialRead,
      list,
      shell,
      edit,
      create,
      mcp,
      rewrite,
      skill,
      "background-process": backgroundProcess,
      "manage-background-process": manageBackgroundProcess,
      glob,
      grep,
      "lsp-definition": lspDefinition,
      "lsp-references": lspReferences,
      "lsp-hover": lspHover,
      "lsp-diagnostics": lspDiagnostics,
      "lsp-document-symbol": lspDocumentSymbol,
      "lsp-implementation": lspImplementation,
      "lsp-incoming-calls": lspIncomingCalls,
      "lsp-outgoing-calls": lspOutgoingCalls,
    },
    agents: {},
  });

export type OctoIR = AgentIR<typeof octoAgent>;
