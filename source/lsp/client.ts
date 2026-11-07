import { type Writable } from "node:stream";
import path from "path";
import { t } from "structural";
import { err, errorToString, ok, type Result } from "../libocto/result.ts";
import { logger } from "../libocto/logger.ts";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  CallHierarchyItem,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  Range,
} from "vscode-languageserver-types";
import { DiagnosticSeverity, SymbolKind } from "vscode-languageserver-types";
import { type TransportProcess } from "../libocto/transport.ts";
import type { Transport } from "../libocto/transport.ts";

// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart
const HEADER_DELIMITER_STRING = "\r\n\r\n";
// effectively the same but avoids issues with buffer encoding
const HEADER_DELIMITER_BUFFER = Buffer.from(HEADER_DELIMITER_STRING);

const INITIALIZE_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 5_000;
const DIAGNOSTICS_WAIT_TIMEOUT_MS = 10_000;
const DIAGNOSTIC_POLL_INTERVAL_MS = 100;

export type InstalledLspConfig = {
  serverName: string;
  command: string[];
  extensions: string[];
  rootCandidates: string[];
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: string) => void;
};

// Only validates what downstream code dereferences: formatDiagnostics reads range.start.line
// and the diagnostic message; everything else (severity, code, source) is optional there.
const LspPositionSchema = t.subtype({
  line: t.num,
  character: t.num,
});

const LspRangeSchema = t.subtype({
  start: LspPositionSchema,
  end: LspPositionSchema,
});

const LspDiagnosticSchema = t.subtype({
  range: LspRangeSchema,
  message: t.str,
});

const PublishDiagnosticsParamsSchema = t.subtype({
  uri: t.str,
  diagnostics: t.array(LspDiagnosticSchema),
});

/** --- Type Guards --- */
// LSP Requests often return `any` types

function isRange(r: any): r is Range {
  return (
    r &&
    typeof r.start?.line === "number" &&
    typeof r.start?.character === "number" &&
    typeof r.end?.line === "number" &&
    typeof r.end?.character === "number"
  );
}

function isLocation(l: any): l is Location {
  return l && typeof l.uri === "string" && isRange(l.range);
}

function isCallHierarchyItem(item: any): item is CallHierarchyItem {
  return (
    item &&
    typeof item.name === "string" &&
    typeof item.kind === "number" &&
    typeof item.uri === "string" &&
    isRange(item.range) &&
    isRange(item.selectionRange)
  );
}

function isIncomingCall(c: any): c is CallHierarchyIncomingCall {
  return c && isCallHierarchyItem(c.from) && Array.isArray(c.fromRanges);
}

function isOutgoingCall(c: any): c is CallHierarchyOutgoingCall {
  return c && isCallHierarchyItem(c.to) && Array.isArray(c.fromRanges);
}

function isDocumentSymbol(s: any): s is DocumentSymbol {
  return (
    s &&
    typeof s.name === "string" &&
    typeof s.kind === "number" &&
    isRange(s.range) &&
    isRange(s.selectionRange)
  );
}

const CLIENT_CAPABILITIES = {
  textDocument: {
    /** {@link LspClient#getDiagnostics} */
    publishDiagnostics: {
      relatedInformation: true,
    },
    /** {@link LspClient#getHover} */
    hover: {
      contentFormat: ["markdown", "plaintext"],
      dynamicRegistration: false,
    },
    /** {@link LspClient#getDefinition} */
    definition: {
      dynamicRegistration: false,
      linkSupport: false,
    },
    /** {@link LspClient#getReferences} */
    references: {
      dynamicRegistration: false,
    },
    /** {@link LspClient#getImplementation} */
    implementation: {
      dynamicRegistration: false,
    },
    /** {@link LspClient#getDocumentSymbols} */
    documentSymbol: {
      dynamicRegistration: false,
      hierarchicalDocumentSymbolSupport: true,
    },
    /** {@link LspClient#getIncomingCalls}, {@link LspClient#getOutgoingCalls} */
    callHierarchy: {
      dynamicRegistration: false,
    },
  },
};

export class LspClient {
  private process: TransportProcess | null = null;
  private requestIdCounter = 1;
  private pendingRequests = new Map<number, PendingRequest>(); // indexed by requestId
  private buffer = Buffer.alloc(0);
  private initialized = false;
  private latestDiagnostics = new Map<string, Diagnostic[]>(); // used for `textDocument/publishDiagnostics` indexed by file URI
  private diagnosticsVersion = 0; // used to track ordering of diagnostics updates
  private fileVersions = new Map<string, number>(); // used by all LSP methods to track ordering of changes

  constructor(
    private serverConfig: InstalledLspConfig,
    private rootPath: string,
    private readonly transport: Transport,
  ) {}

  async start(): Promise<Result<null, string>> {
    const [cmd, ...args] = this.serverConfig.command;
    if (!cmd) return err(`LSP server "${this.serverConfig.serverName}" has empty command`);

    this.process = this.transport.spawn(cmd, args, {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const lspProcess = this.process;

    const stdout = lspProcess.stdout;
    if (!stdout) return err(`LSP server "${this.serverConfig.serverName}" has no stdout`);
    stdout.on("data", (chunk: Buffer) => this.onData(chunk));

    lspProcess.on("error", error => {
      for (const [, req] of this.pendingRequests) {
        req.reject(`LSP server "${this.serverConfig.serverName}" crashed: ${errorToString(error)}`);
      }
      this.pendingRequests.clear();
    });

    lspProcess.on("exit", () => {
      for (const [, req] of this.pendingRequests) {
        req.reject(`LSP server "${this.serverConfig.serverName}" exited unexpectedly`);
      }
      this.pendingRequests.clear();
      this.initialized = false;
    });

    const initialized = await this.request(
      "initialize",
      {
        processId: process.pid,
        capabilities: CLIENT_CAPABILITIES,
        rootUri: `file://${this.rootPath}`,
        rootPath: this.rootPath,
      },
      INITIALIZE_TIMEOUT_MS,
    );
    if (!initialized.success) return initialized;

    this.notify("initialized", {});
    this.initialized = true;
    return ok(null);
  }

  async openFile(filePath: string, content: string): Promise<void> {
    const uri = fileUri(filePath);
    const prevVersion = this.fileVersions.get(uri);
    const version = (prevVersion ?? 0) + 1;
    this.fileVersions.set(uri, version);

    if (prevVersion == null) {
      const languageId = EXTENSION_TO_LANGUAGE[path.extname(filePath)];
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version, text: content },
      });
    } else {
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
    }
  }

  // returns the location where a symbol was originally defined
  // when given a location of that symbol being used elsewhere
  async getDefinition(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Result<Location[], string>> {
    const result = await this.request("textDocument/definition", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!result.success) return result;
    if (!Array.isArray(result.data)) return ok([]);
    return ok(result.data.filter(isLocation));
  }

  // similar to getDefinition, but jumps past interfaces and abstract classes to the code that implements them
  async getImplementation(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Result<Location[], string>> {
    const result = await this.request("textDocument/implementation", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!result.success) return result;
    if (!Array.isArray(result.data)) return ok([]);
    return ok(result.data.filter(isLocation));
  }

  // returns all locations where a symbol is referenced, including its definition
  async getReferences(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Result<Location[], string>> {
    const result = await this.request("textDocument/references", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
      context: { includeDeclaration: true },
    });
    if (!result.success) return result;
    if (!Array.isArray(result.data)) return ok([]);
    return ok(result.data.filter(isLocation));
  }

  // returns hover information (e.g. type info) for a symbol at a given location
  async getHover(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Result<string | null, string>> {
    const result = await this.request("textDocument/hover", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!result.success) return result;
    const hover: Hover | null = result.data;
    if (!hover) return ok(null);
    return ok(formatHoverContents(hover.contents));
  }

  // list all DocumentSymbols (e.g. functions, classes, variables) in a file
  // including their names, kinds, and locations
  async getDocumentSymbols(filePath: string): Promise<Result<DocumentSymbol[], string>> {
    const result = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: fileUri(filePath) },
    });
    if (!result.success) return result;
    if (!Array.isArray(result.data)) return ok([]);
    return ok(result.data.filter(isDocumentSymbol));
  }

  // NOTE: `textDocument/prepareCallHierarchy` is NOT an LSP method that is useful to expose directly
  // `textDocument/incomingCalls` and `textDocument/outgoingCalls` need a `CallHierarchyItem` to run.
  // all this function does is find the symbol's definition and info about it, returning a `CallHierarchyItem`
  private async prepareCallHierarchy(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Result<CallHierarchyItem[], string>> {
    const items = await this.request("textDocument/prepareCallHierarchy", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!items.success) return items;
    if (!Array.isArray(items.data)) return ok([]);
    return ok(items.data.filter(isCallHierarchyItem));
  }

  // returns all the places a symbol is called from
  // when given a location of that symbol
  async getIncomingCalls(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Result<CallHierarchyIncomingCall[], string>> {
    const items = await this.prepareCallHierarchy(filePath, line, character);
    if (!items.success) return items;
    if (items.data.length === 0) return ok([]);
    const result = await this.request("callHierarchy/incomingCalls", { item: items.data[0] });
    if (!result.success) return result;
    if (!Array.isArray(result.data)) return ok([]);
    return ok(result.data.filter(isIncomingCall));
  }

  // returns all the places a symbol calls to
  // when given a location of that symbol
  async getOutgoingCalls(
    filePath: string,
    line: number,
    character: number,
  ): Promise<Result<CallHierarchyOutgoingCall[], string>> {
    const items = await this.prepareCallHierarchy(filePath, line, character);
    if (!items.success) return items;
    if (items.data.length === 0) return ok([]);
    const result = await this.request("callHierarchy/outgoingCalls", { item: items.data[0] });
    if (!result.success) return result;
    if (!Array.isArray(result.data)) return ok([]);
    return ok(result.data.filter(isOutgoingCall));
  }

  getDiagnosticsVersion(): number {
    return this.diagnosticsVersion;
  }

  // `textDocument/publishDiagnostics` is a notification based system
  // as contrasted with all the other LSP methods that are request/response based
  // 1) file changes/opens trigger LSP server to send diagnostics asynchronously (automatically!)
  // 2) we call LSP methods inside withLspFile ensuring the file opens before getDiagnostics can be called
  // 3) cache the latest diagnostics for each file as it's changed/opened
  // 4) poll every 100ms until we have diagnostics that are newer than before
  async getDiagnostics(
    filePath: string,
    minVersion?: number,
  ): Promise<Result<Diagnostic[], string>> {
    if (!this.initialized) return ok([]);
    const uri = fileUri(filePath);
    const start = Date.now();
    while (Date.now() - start < DIAGNOSTICS_WAIT_TIMEOUT_MS) {
      const diagnostics = this.latestDiagnostics.get(uri);
      const versionOk = minVersion === undefined || this.diagnosticsVersion > minVersion;
      if (diagnostics !== undefined && versionOk) return ok(diagnostics);
      await new Promise<void>(resolve => setTimeout(resolve, DIAGNOSTIC_POLL_INTERVAL_MS));
    }
    return ok(this.latestDiagnostics.get(uri) ?? []);
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    if (this.initialized) {
      const shutdownResult = await this.request("shutdown", null);
      // if it errors, we'll just kill the process anyways
      if (shutdownResult.success) this.notify("exit", undefined);
    }
    await this.process.terminate();
    this.process = null;
    this.initialized = false;
  }

  private request(
    method: string,
    params: any,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<Result<any, string>> {
    return new Promise(resolve => {
      const stdin = this.process?.stdin;
      if (!stdin?.writable) {
        resolve(err(`LSP server "${this.serverConfig.serverName}" is not running`));
        return;
      }

      const requestId = this.requestIdCounter++;
      this.pendingRequests.set(requestId, {
        resolve: (value: any) => {
          resolve(ok(value));
        },
        reject: (reason: string) => {
          resolve(err(reason));
        },
      });

      try {
        this.send(stdin, { jsonrpc: "2.0", id: requestId, method, params });
      } catch {
        this.pendingRequests.delete(requestId);
        resolve(err(`Failed to send "${method}" to LSP server "${this.serverConfig.serverName}"`));
        return;
      }

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve(err(`LSP request "${method}" timed out after ${timeoutMs / 1000}s`));
        }
      }, timeoutMs);
    });
  }

  // used for LSP methods `initialized`, `exit`, `textDocument/didOpen`, `textDocument/didChange`
  private notify(method: string, params: any): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable) return;
    try {
      this.send(stdin, { jsonrpc: "2.0", method, params });
    } catch {
      // The connection is dead; pending and future requests will fail via error/exit events.
    }
  }

  private send(stdin: Writable, msg: object): void {
    const body = JSON.stringify(msg);
    stdin.write(`Content-Length: ${Buffer.byteLength(body)}${HEADER_DELIMITER_STRING}${body}`);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf(HEADER_DELIMITER_BUFFER);
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString();
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;
      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + HEADER_DELIMITER_BUFFER.length;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString();
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      try {
        this.handleMessage(JSON.parse(body));
      } catch (e) {
        // A malformed frame shouldn't kill the process: drop it and keep processing.
        logger.log.verbose(
          `Dropping malformed LSP data from "${this.serverConfig.serverName}": ${errorToString(e)}`,
        );
      }
    }
  }

  private handleMessage(msg: any): void {
    if (msg.id != null && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) req.reject(`LSP error: ${errorToString(msg.error)}`);
      else req.resolve(msg.result);
      return;
    }

    // pendingRequests are only for request/response messages, not notifications like publishDiagnostics
    if (msg.method === "textDocument/publishDiagnostics") {
      if (!PublishDiagnosticsParamsSchema.guard(msg.params)) return;
      this.latestDiagnostics.set(msg.params.uri, msg.params.diagnostics);
      this.diagnosticsVersion += 1;
    }
  }
}

function fileUri(filePath: string): string {
  return `file://${filePath}`;
}
export const EXTENSION_TO_LANGUAGE: Record<string, string | undefined> = {
  ".py": "python",
  ".pyi": "python",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".kt": "kotlin",
  ".lua": "lua",
};

/**
 * Depending on LSP language, returns documentation/types/signatures/etc
 * for the target constant or method.
 *
 * @param {MarkupContent | string} contents - Based on the language, this may either be a
 * `MarkupContent` object with a `value` property, or a string (in that priority order).
 */
function formatHoverContents(contents: Hover["contents"]): string {
  if (contents == null) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents.map(c => (typeof c === "string" ? c : c.value)).join("\n\n");
  }
  return contents.value;
}

const SEVERITY_NAMES: Record<number, string> = {
  [DiagnosticSeverity.Error]: "Error",
  [DiagnosticSeverity.Warning]: "Warning",
  [DiagnosticSeverity.Information]: "Info",
  [DiagnosticSeverity.Hint]: "Hint",
};

/**
 * Formats a list of errors & diagnostics into an easy-to-read string.
 *
 * @example
 * Returns: ```
 *  [[ Error ]]: Line: 10 | Source: tsserver | Error Code: 2345 | "Argument of type 'string' is not assignable to parameter of type 'number'."
 * ```
 */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return "No diagnostics found.";
  return diagnostics
    .map(diagnostic => {
      const { severity: diagnosticSeverity, range, source, code, message } = diagnostic;
      const severity = SEVERITY_NAMES[diagnosticSeverity ?? DiagnosticSeverity.Error] ?? "Unknown";
      const line = range.start.line + 1;
      return `[[ ${severity} ]]: Line: ${line} | Source: ${source} | Error Code: ${code} | "${message}"`;
    })
    .join("\n");
}

/**
 * Formats a list of locations into an easy-to-read string.
 *
 * @example
 * Returns: ```
 *  /src/services/UserService.ts:10:1
 *  /src/main.ts:15:10
 * ```
 */
export function formatLocations(locations: Location[]): string {
  if (locations.length === 0) return "No locations found.";
  return locations
    .map(loc => {
      const filePath = loc.uri.replace("file://", "");
      const line = loc.range.start.line + 1;
      const col = loc.range.start.character + 1;
      return `${filePath}:${line}:${col}`;
    })
    .join("\n");
}

const SYMBOL_KIND_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(SymbolKind).map(([k, v]) => [v, k]),
);

function symbolKindName(kind: number): string {
  return SYMBOL_KIND_NAMES[kind] ?? `SymbolKind(${kind})`;
}

/**
 * Formats a list of document symbols into an easy-to-read string.
 * Indentation is used to show hierarchy.
 * @example
 * Returns: ```
 *   UserService (Class) 10:1
 *     validateUser (Method) 15:4
 *       validateEmail (Function) 22:8
 *       validatePhone (Function) 30:8
 *     getUserById (Method) 38:4
 * ```
 */
export function formatDocumentSymbols(symbols: DocumentSymbol[], indent = 0): string {
  if (symbols.length === 0 && indent === 0) return "No symbols found.";
  const prefix = "  ".repeat(indent);
  return symbols
    .map(symbol => {
      const { name, selectionRange, kind, children } = symbol;
      const line = selectionRange.start.line + 1;
      const col = selectionRange.start.character + 1;
      const loc = `${line}:${col}`;
      const output = `${prefix}${name} (${symbolKindName(kind)}) ${loc}`;
      if (children && children.length > 0) {
        return output + "\n" + formatDocumentSymbols(children, indent + 1);
      }
      return output;
    })
    .join("\n");
}

/**
 * Formats a list of calls into an easy-to-read string.
 * @example
 * Returns: ```
 *   updateUser (Method) /src/test.ts:42:12
 *   handleRequest (Function) /src/test.ts:15:5
 * ```
 */
export function formatCallHierarchy(
  calls: (CallHierarchyIncomingCall | CallHierarchyOutgoingCall)[],
  direction: "incoming" | "outgoing",
): string {
  if (calls.length === 0) return `No ${direction} calls found.`;
  return calls
    .map(call => {
      let item: CallHierarchyItem;
      if ("from" in call) {
        item = call.from;
      } else {
        item = call.to;
      }
      const filePath = item.uri.replace("file://", "");
      const line = item.selectionRange.start.line + 1;
      const col = item.selectionRange.start.character + 1;
      return `${item.name} (${symbolKindName(item.kind)}) ${filePath}:${line}:${col}`;
    })
    .join("\n");
}

// indexed by `serverName:rootPath` to client instance
const cachedLspClients = new Map<string, LspClient>();

function lspClientClientCacheKey(serverConfig: InstalledLspConfig, rootPath: string): string {
  return `${serverConfig.serverName}:${rootPath}`;
}

export function getRunningLspClient(
  serverConfig: InstalledLspConfig,
  rootPath: string,
): LspClient | undefined {
  const cacheKey = lspClientClientCacheKey(serverConfig, rootPath);
  return cachedLspClients.get(cacheKey);
}

export async function getOrStartLspClient(
  serverConfig: InstalledLspConfig,
  rootPath: string,
  transport: Transport,
): Promise<Result<LspClient, string>> {
  const running = getRunningLspClient(serverConfig, rootPath);
  if (running) return ok(running);

  const client = new LspClient(serverConfig, rootPath, transport);
  const started = await client.start();
  if (!started.success) return started;

  const cacheKey = lspClientClientCacheKey(serverConfig, rootPath);
  cachedLspClients.set(cacheKey, client);
  return ok(client);
}

export async function shutdownLspClients(): Promise<void> {
  const entries = Array.from(cachedLspClients.entries());
  cachedLspClients.clear();
  for (const [, client] of entries) {
    try {
      await client.shutdown();
    } catch {
      // TODO: surface that client shutdown failed
      // although this probably only happens if the parent process is exiting, so less priority
    }
  }
}
