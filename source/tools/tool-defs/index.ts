import read from "../../libocto/tools/read/index.ts";
import partialRead from "./partial-read.ts";
import list from "./list.ts";
import shell from "./bash.ts";
import edit from "../../libocto/tools/edit/index.ts";
import create from "../../libocto/tools/create/index.ts";
import mcp from "./mcp.ts";
import fetch from "./fetch.ts";
import rewrite from "../../libocto/tools/rewrite/index.ts";
import skill from "./skill.ts";
import webSearch from "./web-search.ts";
import webResearch from "./web-research.ts";
import backgroundProcess from "./background-process.ts";
import manageBackgroundProcess from "./manage-background-process.ts";
import glob from "./glob.ts";
import grep from "./grep.ts";
import explore from "./explore.ts";
import lspDefinition from "./lsp-definition.ts";
import lspReferences from "./lsp-references.ts";
import lspHover from "./lsp-hover.ts";
import lspDiagnostics from "./lsp-diagnostics.ts";
import lspDocumentSymbol from "./lsp-document-symbol.ts";
import lspImplementation from "./lsp-implementation.ts";
import lspIncomingCalls from "./lsp-incoming-calls.ts";
import lspOutgoingCalls from "./lsp-outgoing-calls.ts";

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
