import { spawn, type ChildProcess } from "child_process";
import { type Writable } from "node:stream";
import path from "path";
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

// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#headerPart
const HEADER_DELIMITER_STRING = "\r\n\r\n";
// effectively the same but avoids issues with buffer encoding
const HEADER_DELIMITER_BUFFER = Buffer.from(HEADER_DELIMITER_STRING);

const REQUEST_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_POLL_INTERVAL_MS = 100;

export type InstalledLspConfig = {
  serverName: string;
  command: string[];
  extensions: string[];
  rootCandidates: string[];
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
};

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
  private process: ChildProcess | null = null;
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
  ) {}

  async start(): Promise<void> {
    const [cmd, ...args] = this.serverConfig.command;
    if (!cmd) throw new Error(`LSP server "${this.serverConfig.serverName}" has empty command`);

    this.process = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: process.env,
    });

    const stdout = this.process.stdout;
    if (!stdout) throw new Error(`LSP server "${this.serverConfig.serverName}" has no stdout`);
    stdout.on("data", (chunk: Buffer) => this.onData(chunk));

    this.process.on("error", err => {
      for (const [, req] of this.pendingRequests) {
        req.reject(
          new Error(`LSP server "${this.serverConfig.serverName}" crashed: ${err.message}`),
        );
      }
      this.pendingRequests.clear();
    });

    this.process.on("exit", () => {
      for (const [, req] of this.pendingRequests) {
        req.reject(new Error(`LSP server "${this.serverConfig.serverName}" exited unexpectedly`));
      }
      this.pendingRequests.clear();
      this.initialized = false;
    });

    await this.request("initialize", {
      processId: process.pid,
      capabilities: CLIENT_CAPABILITIES,
      rootUri: `file://${this.rootPath}`,
      rootPath: this.rootPath,
    });

    this.notify("initialized", {});
    this.initialized = true;
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
  async getDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
    const result = await this.request("textDocument/definition", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!Array.isArray(result)) return [];
    return result.filter(isLocation);
  }

  // similar to getDefinition, but jumps past interfaces and abstract classes to the code that implements them
  async getImplementation(filePath: string, line: number, character: number): Promise<Location[]> {
    const result = await this.request("textDocument/implementation", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!Array.isArray(result)) return [];
    return result.filter(isLocation);
  }

  // returns all locations where a symbol is referenced, including its definition
  // when given a location of that symbol being used elsewhere
  async getReferences(filePath: string, line: number, character: number): Promise<Location[]> {
    const result = await this.request("textDocument/references", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
      context: { includeDeclaration: true },
    });
    if (!Array.isArray(result)) return [];
    return result.filter(isLocation);
  }

  // returns hover information (e.g. type info) for a symbol at a given location
  async getHover(filePath: string, line: number, character: number): Promise<string | null> {
    const result: Hover | null = await this.request("textDocument/hover", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!result) return null;
    return formatHoverContents(result.contents);
  }

  // list all DocumentSymbols (e.g. functions, classes, variables) in a file
  // including their names, kinds, and locations
  async getDocumentSymbols(filePath: string): Promise<DocumentSymbol[]> {
    const result = await this.request("textDocument/documentSymbol", {
      textDocument: { uri: fileUri(filePath) },
    });
    if (!Array.isArray(result)) return [];
    return result.filter(isDocumentSymbol);
  }

  // NOTE: `textDocument/prepareCallHierarchy` is NOT an LSP method that is useful to expose directly
  // `textDocument/incomingCalls` and `textDocument/outgoingCalls` need a `CallHierarchyItem` to run.
  // all this function does is find the symbol's definition and info about it, returning a `CallHierarchyItem`
  private async prepareCallHierarchy(
    filePath: string,
    line: number,
    character: number,
  ): Promise<CallHierarchyItem[]> {
    const items = await this.request("textDocument/prepareCallHierarchy", {
      textDocument: { uri: fileUri(filePath) },
      position: { line, character },
    });
    if (!Array.isArray(items)) return [];
    return items.filter(isCallHierarchyItem);
  }

  // returns all the places a symbol is called from
  // when given a location of that symbol
  async getIncomingCalls(
    filePath: string,
    line: number,
    character: number,
  ): Promise<CallHierarchyIncomingCall[]> {
    const items = await this.prepareCallHierarchy(filePath, line, character);
    if (items.length === 0) return [];
    const result = await this.request("callHierarchy/incomingCalls", { item: items[0] });
    if (!Array.isArray(result)) return [];
    return result.filter(isIncomingCall);
  }

  // returns all the places a symbol calls to
  // when given a location of that symbol
  async getOutgoingCalls(
    filePath: string,
    line: number,
    character: number,
  ): Promise<CallHierarchyOutgoingCall[]> {
    const items = await this.prepareCallHierarchy(filePath, line, character);
    if (items.length === 0) return [];
    const result = await this.request("callHierarchy/outgoingCalls", { item: items[0] });
    if (!Array.isArray(result)) return [];
    return result.filter(isOutgoingCall);
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
  async getDiagnostics(filePath: string, minVersion?: number): Promise<Diagnostic[]> {
    if (!this.initialized) return [];
    const uri = fileUri(filePath);
    const start = Date.now();
    while (Date.now() - start < REQUEST_TIMEOUT_MS) {
      const diagnostics = this.latestDiagnostics.get(uri);
      const versionOk = minVersion === undefined || this.diagnosticsVersion > minVersion;
      if (diagnostics !== undefined && versionOk) return diagnostics;
      await new Promise<void>(resolve => setTimeout(resolve, DIAGNOSTIC_POLL_INTERVAL_MS));
    }
    return this.latestDiagnostics.get(uri) ?? [];
  }

  async shutdown(): Promise<void> {
    if (!this.process || !this.initialized) return;
    try {
      await this.request("shutdown", null);
      this.notify("exit", undefined);
    } catch {
      // if it errors, we'll just kill the process anyways
    }
    this.process.kill();
    this.process = null;
    this.initialized = false;
  }

  private request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const stdin = this.process?.stdin;
      if (!stdin?.writable) {
        reject(new Error(`LSP server "${this.serverConfig.serverName}" is not running`));
        return;
      }

      const requestId = this.requestIdCounter++;
      this.pendingRequests.set(requestId, {
        resolve: (value: any) => {
          resolve(value);
        },
        reject: (reason: Error) => {
          reject(reason);
        },
      });
      this.send(stdin, { jsonrpc: "2.0", id: requestId, method, params });

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(
            new Error(`LSP request "${method}" timed out after ${REQUEST_TIMEOUT_MS / 1000}s`),
          );
        }
      }, REQUEST_TIMEOUT_MS);
    });
  }

  // used for LSP methods `initialized`, `exit`, `textDocument/didOpen`, `textDocument/didChange`
  private notify(method: string, params: any): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable) return;
    this.send(stdin, { jsonrpc: "2.0", method, params });
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
      } catch {
        throw new Error(`Failed to parse LSP data: ${body}`);
      }
    }
  }

  private handleMessage(msg: any): void {
    if (msg.id != null && this.pendingRequests.has(msg.id)) {
      const req = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) req.reject(new Error(`LSP error: ${msg.error.message}`));
      else req.resolve(msg.result);
      return;
    }

    // pendingRequests are only for request/response messages, not notifications like publishDiagnostics
    if (msg.method === "textDocument/publishDiagnostics" && msg.params) {
      const uri: string = msg.params.uri;
      const diagnostics: Diagnostic[] = msg.params.diagnostics ?? [];
      this.latestDiagnostics.set(uri, diagnostics);
      this.diagnosticsVersion += 1;
    }
  }
}

function fileUri(filePath: string): string {
  return `file://${path.resolve(filePath)}`;
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
): Promise<LspClient> {
  let client = getRunningLspClient(serverConfig, rootPath);
  if (client) return client;

  client = new LspClient(serverConfig, rootPath);
  await client.start();
  const cacheKey = lspClientClientCacheKey(serverConfig, rootPath);
  cachedLspClients.set(cacheKey, client);
  return client;
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
