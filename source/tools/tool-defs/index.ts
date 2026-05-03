import read from "./read.ts";
import list from "./list.ts";
import shell from "./bash.ts";
import edit from "./edit.ts";
import create from "./create.ts";
import mcp from "./mcp.ts";
import fetch from "./fetch.ts";
import append from "./append.ts";
import prepend from "./prepend.ts";
import rewrite from "./rewrite.ts";
import skill from "./skill.ts";
import webSearch from "./web-search.ts";
import glob from "./glob.ts";
import grep from "./grep.ts";
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
  list,
  shell,
  edit,
  create,
  mcp,
  fetch,
  append,
  prepend,
  rewrite,
  skill,
  "web-search": webSearch,
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
};
