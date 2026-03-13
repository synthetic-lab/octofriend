import path from "path";
import { randomUUID } from "crypto";
import * as acp from "@agentclientprotocol/sdk";
import { Config, ModelConfig, assertKeyForModel } from "../config.ts";
import { trajectoryArc, StateEvents } from "../agent/trajectory-arc.ts";
import { LlmIR, ToolCallRequest } from "../ir/llm-ir.ts";
import { SKIP_CONFIRMATION_TOOLS, loadTools, runTool } from "../tools/index.ts";
import { ToolError, ToolResult } from "../tools/common.ts";
import { FileOutdatedError, fileTracker } from "../tools/file-tracker.ts";
import { AbortError } from "../transports/transport-common.ts";
import { SessionTransport } from "./session-transport.ts";

type Metadata = {
  version: string;
};

type SessionState = {
  id: string;
  cwd: string;
  transport: SessionTransport;
  messages: LlmIR[];
  selectedModelId: string;
  allowAlways: Set<string>;
  rejectAlways: Set<string>;
  pendingPrompt: AbortController | null;
};

type PermissionDecision = "allow" | "reject" | "cancelled";
type ToolFailureIr = Extract<LlmIR, { role: "tool-error" | "file-outdated" | "file-unreadable" }>;

const MUTATING_TOOL_NAMES = new Set(["append", "prepend", "rewrite", "edit", "create"] as const);
const MODEL_CONFIG_ID = "model";

export class OctofriendAcpAgent implements acp.Agent {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly connection: acp.AgentSideConnection,
    private readonly config: Config,
    private readonly metadata: Metadata,
  ) {}

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
        mcpCapabilities: {
          http: false,
          sse: false,
        },
        sessionCapabilities: {},
      },
      agentInfo: {
        name: "octofriend",
        title: "Octofriend",
        version: this.metadata.version,
      },
      authMethods: [],
    };
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse | void> {
    return {};
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (!path.isAbsolute(params.cwd)) {
      throw acp.RequestError.invalidParams(undefined, "session/new cwd must be an absolute path");
    }

    if (params.mcpServers.length > 0) {
      throw acp.RequestError.invalidParams(
        undefined,
        "ACP-provided mcpServers are not supported yet in Octofriend ACP mode",
      );
    }

    const defaultModel = this.defaultModel();
    const sessionId = randomUUID();
    const session: SessionState = {
      id: sessionId,
      cwd: path.resolve(params.cwd),
      transport: new SessionTransport(path.resolve(params.cwd)),
      messages: [],
      selectedModelId: defaultModel.nickname,
      allowAlways: new Set<string>(),
      rejectAlways: new Set<string>(),
      pendingPrompt: null,
    };

    this.sessions.set(sessionId, session);
    return {
      sessionId,
      configOptions: this.modelConfigOptions(session.selectedModelId),
    };
  }

  async setSessionConfigOption(
    params: acp.SetSessionConfigOptionRequest,
  ): Promise<acp.SetSessionConfigOptionResponse> {
    const session = this.requireSession(params.sessionId);

    if (params.configId !== MODEL_CONFIG_ID) {
      throw acp.RequestError.invalidParams(
        undefined,
        `Unsupported config option: ${params.configId}`,
      );
    }

    const model = this.findModelById(params.value);
    if (!model) {
      const values = this.config.models.map(model => model.nickname).join(", ");
      throw acp.RequestError.invalidParams(
        undefined,
        `Unknown model value '${params.value}'. Available values: ${values}`,
      );
    }

    session.selectedModelId = model.nickname;
    const configOptions = this.modelConfigOptions(session.selectedModelId);

    await this.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "config_option_update",
        configOptions,
      },
    });

    return {
      configOptions,
    };
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.requireSession(params.sessionId);
    if (session.pendingPrompt) {
      throw acp.RequestError.invalidParams(
        undefined,
        "A prompt is already running for this session",
      );
    }

    const promptText = promptContentToText(params.prompt);
    session.messages.push({
      role: "user",
      content: promptText,
    });

    const abortController = new AbortController();
    session.pendingPrompt = abortController;

    try {
      const model = this.modelForSession(session);
      const apiKey = await assertKeyForModel(model, this.config);

      while (true) {
        if (abortController.signal.aborted) {
          return { stopReason: "cancelled" };
        }

        let emittedContent = false;
        let emittedReasoning = false;
        let updateChain = Promise.resolve();
        let updateError: unknown = null;

        const enqueueUpdate = (update: acp.SessionUpdate) => {
          updateChain = updateChain.then(async () => {
            if (updateError) return;
            try {
              await this.connection.sessionUpdate({
                sessionId: session.id,
                update,
              });
            } catch (error) {
              updateError = error;
            }
          });
        };

        const handler: { [K in keyof StateEvents]: (state: StateEvents[K]) => void } = {
          startResponse: () => {},
          startCompaction: () => {},
          compactionProgress: () => {},
          compactionParsed: () => {},
          autofixingJson: () => {},
          autofixingDiff: () => {},
          retryTool: () => {},
          responseProgress: event => {
            if (event.delta.type === "content" && event.delta.value.length > 0) {
              emittedContent = true;
              enqueueUpdate({
                sessionUpdate: "agent_message_chunk",
                content: {
                  type: "text",
                  text: event.delta.value,
                },
              });
            }

            if (event.delta.type === "reasoning" && event.delta.value.length > 0) {
              emittedReasoning = true;
              enqueueUpdate({
                sessionUpdate: "agent_thought_chunk",
                content: {
                  type: "text",
                  text: event.delta.value,
                },
              });
            }
          },
        };

        const finish = await trajectoryArc({
          apiKey,
          model,
          messages: session.messages,
          config: this.config,
          transport: session.transport,
          abortSignal: abortController.signal,
          handler,
        });

        await updateChain;
        if (updateError) throw updateError;

        if (!emittedContent || !emittedReasoning) {
          const fallbackAssistant = [...finish.irs].reverse().find(ir => ir.role === "assistant");
          if (fallbackAssistant?.role === "assistant") {
            if (!emittedReasoning && fallbackAssistant.reasoningContent) {
              await this.connection.sessionUpdate({
                sessionId: session.id,
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: {
                    type: "text",
                    text: fallbackAssistant.reasoningContent,
                  },
                },
              });
            }

            if (!emittedContent && fallbackAssistant.content.length > 0) {
              await this.connection.sessionUpdate({
                sessionId: session.id,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: fallbackAssistant.content,
                  },
                },
              });
            }
          }
        }

        session.messages.push(...finish.irs);

        if (finish.reason.type === "abort") {
          return { stopReason: "cancelled" };
        }

        if (finish.reason.type === "needs-response") {
          return { stopReason: "end_turn" };
        }

        if (finish.reason.type === "request-error") {
          throw acp.RequestError.internalError(
            {
              curl: finish.reason.curl,
            },
            finish.reason.requestError,
          );
        }

        const toolDecision = await this.handleToolRequest({
          session,
          toolCall: finish.reason.toolCall,
          signal: abortController.signal,
        });

        if (toolDecision === "cancelled") {
          return { stopReason: "cancelled" };
        }
      }
    } catch (error) {
      if (isAbort(error, abortController.signal)) {
        return { stopReason: "cancelled" };
      }
      throw error;
    } finally {
      session.pendingPrompt = null;
    }
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.requireSession(params.sessionId);
    session.pendingPrompt?.abort();
  }

  private async handleToolRequest(params: {
    session: SessionState;
    toolCall: ToolCallRequest;
    signal: AbortSignal;
  }): Promise<"continue" | "cancelled"> {
    const { session, toolCall, signal } = params;
    const pendingToolCall = this.toToolCallUpdate(toolCall, session.cwd, "pending");

    await this.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call",
        ...pendingToolCall,
      },
    });

    const permission = await this.resolvePermission({ session, toolCall, pendingToolCall, signal });

    if (permission === "cancelled") {
      return "cancelled";
    }

    if (permission === "reject") {
      session.messages.push({
        role: "tool-reject",
        toolCall,
      });

      await this.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          status: "failed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "Tool call rejected by user.",
              },
            },
          ],
          rawOutput: {
            error: "Tool call rejected by user",
          },
        },
      });

      return "continue";
    }

    await this.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: toolCall.toolCallId,
        status: "in_progress",
      },
    });

    const tools = await loadTools(session.transport, signal, this.config);
    try {
      const result = await runTool(
        signal,
        session.transport,
        tools,
        toolCall.function,
        this.config,
        session.selectedModelId,
      );

      session.messages.push(this.toolOutputIr(toolCall, result, session.cwd));

      await this.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          status: "completed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: result.content,
              },
            },
          ],
          rawOutput: {
            content: result.content,
            lines: result.lines,
          },
        },
      });

      return "continue";
    } catch (error) {
      if (isAbort(error, signal)) {
        return "cancelled";
      }

      const errorIr = await this.toolErrorIr(toolCall, error, session);
      session.messages.push(errorIr);

      await this.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: toolCall.toolCallId,
          status: "failed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: errorIr.error,
              },
            },
          ],
          rawOutput: {
            error: errorIr.error,
          },
        },
      });

      return "continue";
    }
  }

  private async resolvePermission(params: {
    session: SessionState;
    toolCall: ToolCallRequest;
    pendingToolCall: Omit<acp.ToolCall, "sessionUpdate">;
    signal: AbortSignal;
  }): Promise<PermissionDecision> {
    const { session, toolCall, pendingToolCall, signal } = params;
    const permissionKey = toPermissionKey(toolCall);

    if (session.rejectAlways.has(permissionKey)) return "reject";

    const name = toolCall.function.name;
    const skipConfirmation = SKIP_CONFIRMATION_TOOLS.includes(name as any);
    if (skipConfirmation || session.allowAlways.has(permissionKey)) return "allow";

    const permissionResult = await this.connection.requestPermission({
      sessionId: session.id,
      toolCall: pendingToolCall,
      options: [
        {
          optionId: "allow_once",
          kind: "allow_once",
          name: "Allow once",
        },
        {
          optionId: "allow_always",
          kind: "allow_always",
          name: "Allow always",
        },
        {
          optionId: "reject_once",
          kind: "reject_once",
          name: "Reject once",
        },
        {
          optionId: "reject_always",
          kind: "reject_always",
          name: "Reject always",
        },
      ],
    });

    if (signal.aborted || permissionResult.outcome.outcome === "cancelled") {
      return "cancelled";
    }

    if (permissionResult.outcome.optionId === "allow_once") return "allow";
    if (permissionResult.outcome.optionId === "allow_always") {
      session.allowAlways.add(permissionKey);
      return "allow";
    }
    if (permissionResult.outcome.optionId === "reject_always") {
      session.rejectAlways.add(permissionKey);
      return "reject";
    }

    return "reject";
  }

  private toToolCallUpdate(
    toolCall: ToolCallRequest,
    cwd: string,
    status: acp.ToolCallStatus,
  ): Omit<acp.ToolCall, "sessionUpdate"> {
    return {
      toolCallId: toolCall.toolCallId,
      title: toolTitle(toolCall),
      kind: toToolKind(toolCall.function.name),
      status,
      locations: toolLocations(cwd, toolCall),
      rawInput: toolCall.function.arguments,
    };
  }

  private toolOutputIr(toolCall: ToolCallRequest, result: ToolResult, cwd: string): LlmIR {
    const name = toolCall.function.name;

    if (MUTATING_TOOL_NAMES.has(name as any)) {
      return {
        role: "file-mutate",
        content: result.content,
        toolCall,
        path: resolveToolPath(cwd, toolCall),
      };
    }

    if (name === "read") {
      return {
        role: "file-read",
        content: result.content,
        toolCall,
        path: resolveToolPath(cwd, toolCall),
      };
    }

    return {
      role: "tool-output",
      content: result.content,
      toolCall,
    };
  }

  private async toolErrorIr(
    toolCall: ToolCallRequest,
    error: unknown,
    session: SessionState,
  ): Promise<ToolFailureIr> {
    if (error instanceof ToolError) {
      return {
        role: "tool-error",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.function.name,
        error: error.message,
      };
    }

    if (error instanceof FileOutdatedError) {
      try {
        const absolutePath = path.resolve(session.cwd, error.filePath);
        await fileTracker.readUntracked(
          session.transport,
          session.pendingPrompt!.signal,
          absolutePath,
        );
        return {
          role: "file-outdated",
          toolCall,
          error:
            "File could not be updated because it was modified after being last read. Please read the file again before modifying it.",
        };
      } catch {
        return {
          role: "file-unreadable",
          path: error.filePath,
          toolCall,
          error: `File ${error.filePath} could not be read. Has it been deleted?`,
        };
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      role: "tool-error",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.function.name,
      error: message,
    };
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw acp.RequestError.resourceNotFound(`session:${sessionId}`);
    }

    return session;
  }

  private defaultModel(): ModelConfig {
    const model = this.config.models[0];
    if (!model) {
      throw acp.RequestError.internalError(undefined, "No model configured in octofriend config");
    }
    return model;
  }

  private findModelById(modelId: string): ModelConfig | null {
    return this.config.models.find(model => model.nickname === modelId) ?? null;
  }

  private modelForSession(session: SessionState): ModelConfig {
    return this.findModelById(session.selectedModelId) ?? this.defaultModel();
  }

  private modelConfigOptions(currentValue: string): acp.SessionConfigOption[] {
    const options: acp.SessionConfigSelectOptions = this.config.models.map(model => ({
      value: model.nickname,
      name: model.nickname,
      description: model.model,
    }));

    return [
      {
        id: MODEL_CONFIG_ID,
        type: "select",
        category: "model",
        name: "Model",
        description: "Select the model used for this ACP session",
        currentValue,
        options,
      },
    ];
  }
}

function promptContentToText(prompt: acp.ContentBlock[]): string {
  const parts: string[] = [];

  for (const block of prompt as Array<any>) {
    if (block.type === "text") {
      parts.push(block.text);
      continue;
    }

    if (block.type === "resource_link") {
      const name = block.name || block.title || "resource";
      const description = block.description ? `\n${block.description}` : "";
      parts.push(`[resource: ${name}] ${block.uri}${description}`);
      continue;
    }

    if (block.type === "resource") {
      const uri = block.resource?.uri || "resource://unknown";
      if (typeof block.resource?.text === "string") {
        parts.push(`[resource: ${uri}]\n${block.resource.text}`);
      } else {
        parts.push(`[resource: ${uri}] (binary content omitted)`);
      }
      continue;
    }

    if (block.type === "image" || block.type === "audio") {
      throw acp.RequestError.invalidParams(
        undefined,
        `Prompt content type ${block.type} is unsupported by this ACP adapter`,
      );
    }

    throw acp.RequestError.invalidParams(
      undefined,
      `Unknown prompt content type: ${String(block.type)}`,
    );
  }

  return parts.join("\n\n").trim();
}

function toolTitle(toolCall: ToolCallRequest): string {
  const fn = toolCall.function;
  const args = fn.arguments as Record<string, unknown>;

  switch (fn.name) {
    case "read":
      return `Read ${String(args["filePath"] || "file")}`;
    case "edit":
    case "append":
    case "prepend":
    case "rewrite":
    case "create":
      return `Modify ${String(args["filePath"] || "file")}`;
    case "list":
      return `List ${String(args["dirPath"] || args["filePath"] || ".")}`;
    case "shell": {
      const cmd = firstString(args, "cmd");
      if (!cmd) return "Run shell command";
      return `Run: ${previewText(cmd, 120)}`;
    }
    case "fetch": {
      const url = firstString(args, "url");
      return url ? `Fetch ${previewText(url, 120)}` : "Fetch URL";
    }
    case "web-search":
      return firstString(args, "query")
        ? `Search: ${previewText(String(args["query"]), 120)}`
        : "Search the web";
    case "mcp": {
      const server = firstString(args, "server") || "server";
      const tool = firstString(args, "tool") || "tool";
      return `MCP ${server}.${tool}`;
    }
    case "skill":
      return firstString(args, "skillName") ? `Load skill ${args["skillName"]}` : "Load skill";
  }
}

function previewText(value: string, maxLength: number) {
  const condensed = value.replace(/\s+/g, " ").trim();
  if (condensed.length <= maxLength) return condensed;
  if (maxLength <= 3) return condensed.slice(0, maxLength);
  return `${condensed.slice(0, maxLength - 3)}...`;
}

function toToolKind(name: ToolCallRequest["function"]["name"]): acp.ToolKind {
  if (name === "read") return "read";
  if (name === "list") return "search";
  if (name === "shell") return "execute";
  if (name === "fetch" || name === "web-search") return "fetch";
  if (MUTATING_TOOL_NAMES.has(name as any)) return "edit";
  return "other";
}

function toolLocations(cwd: string, toolCall: ToolCallRequest): acp.ToolCallLocation[] {
  const args = toolCall.function.arguments as Record<string, unknown>;
  const pathValue =
    firstString(args, "filePath") || firstString(args, "dirPath") || firstString(args, "path");

  if (!pathValue) return [];

  return [
    {
      path: resolveAbsolute(cwd, pathValue),
    },
  ];
}

function resolveToolPath(cwd: string, toolCall: ToolCallRequest) {
  const args = toolCall.function.arguments as Record<string, unknown>;
  const filePath = firstString(args, "filePath");
  if (!filePath) return cwd;
  return resolveAbsolute(cwd, filePath);
}

function resolveAbsolute(cwd: string, target: string) {
  if (path.isAbsolute(target)) return target;
  return path.resolve(cwd, target);
}

function firstString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string") return value;
  return null;
}

function toPermissionKey(toolCall: ToolCallRequest): string {
  const fn = toolCall.function;

  switch (fn.name) {
    case "read":
    case "list":
      return "read:*";
    case "create":
    case "rewrite":
    case "append":
    case "prepend":
    case "edit":
      return "edits:*";
    case "skill":
    case "shell":
    case "fetch":
    case "web-search":
      return `${fn.name}:*`;
    case "mcp": {
      const args = fn.arguments as Record<string, unknown>;
      const server = typeof args["server"] === "string" ? args["server"] : "unknown";
      const tool = typeof args["tool"] === "string" ? args["tool"] : "unknown";
      return `mcp:${server}:${tool}`;
    }
  }
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof AbortError) return true;
  if (error instanceof Error && error.message === "Aborted") return true;
  return false;
}
