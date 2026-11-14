import read from "../../libocto/tools/read/index.ts";
import partialRead from "../../libocto/tools/partial-read/index.ts";
import list from "../../libocto/tools/list/index.ts";
import shell from "../../libocto/tools/shell/index.ts";
import edit from "../../libocto/tools/edit/index.ts";
import create from "../../libocto/tools/create/index.ts";
import mcp from "../../libocto/tools/mcp/index.ts";
import fetch from "../../libocto/tools/fetch/index.ts";
import rewrite from "../../libocto/tools/rewrite/index.ts";
import skill from "../../libocto/tools/skill/index.ts";
import webSearch from "../../libocto/tools/web-search/index.ts";
import webResearch from "./web-research.ts";
import backgroundProcess from "../../libocto/tools/background-process/index.ts";
import manageBackgroundProcess from "../../libocto/tools/manage-background-process/index.ts";
import glob from "./glob.ts";
import grep from "./grep.ts";
import explore from "./explore.ts";
import lspDefinition from "../../libocto/tools/lsp-definition/index.ts";
import lspReferences from "../../libocto/tools/lsp-references/index.ts";
import lspHover from "../../libocto/tools/lsp-hover/index.ts";
import lspDiagnostics from "../../libocto/tools/lsp-diagnostics/index.ts";
import lspDocumentSymbol from "../../libocto/tools/lsp-document-symbol/index.ts";
import lspImplementation from "../../libocto/tools/lsp-implementation/index.ts";
import lspIncomingCalls from "../../libocto/tools/lsp-incoming-calls/index.ts";
import lspOutgoingCalls from "../../libocto/tools/lsp-outgoing-calls/index.ts";

export default {
  read,
  "partial-read": partialRead,
  list,
  shell,
  edit,
  create,
  mcp,
  fetch,
  rewrite,
  skill,
  "web-search": webSearch,
  "web-research": webResearch,
  "background-process": backgroundProcess,
  "manage-background-process": manageBackgroundProcess,
  glob,
  grep,
  explore,
  "lsp-definition": lspDefinition,
  "lsp-references": lspReferences,
  "lsp-hover": lspHover,
  "lsp-diagnostics": lspDiagnostics,
  "lsp-document-symbol": lspDocumentSymbol,
  "lsp-implementation": lspImplementation,
  "lsp-incoming-calls": lspIncomingCalls,
  "lsp-outgoing-calls": lspOutgoingCalls,
};
