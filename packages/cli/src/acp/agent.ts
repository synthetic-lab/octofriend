import { randomUUID } from "node:crypto";
import path from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import {
	assertKeyForModel,
	type Config,
	type Finish,
	LocalTransport,
	loadTools,
	type ModelConfig,
	runTool,
	type ToolCallRequest,
	type ToolRunResult,
	trajectoryArc,
} from "@octofriend/tui/acp-runtime";
import {
	type AgentdRustBridge,
	createAgentdRustBridge,
} from "../bridge/agent/agent.ts";

type Metadata = { version: string };

export type AcpAgentRuntime = {
	createBridge: typeof createAgentdRustBridge;
	assertKeyForModel: typeof assertKeyForModel;
	trajectoryArc: typeof trajectoryArc;
	loadTools: typeof loadTools;
	runTool: typeof runTool;
};

const DEFAULT_RUNTIME: AcpAgentRuntime = {
	createBridge: createAgentdRustBridge,
	assertKeyForModel,
	trajectoryArc,
	loadTools,
	runTool,
};
const ignoreEvent = () => undefined;

type SessionState = {
	id: string;
	cwd: string;
	transport: LocalTransport;
	messages: unknown[];
	selectedModelId: string;
	allowAlways: Set<string>;
	rejectAlways: Set<string>;
	pendingPrompt: AbortController | null;
};

type PermissionDecision = "allow" | "reject" | "cancelled";
const MODEL_CONFIG_ID = "model";

export class OctofriendAcpAgent implements acp.Agent {
	readonly #sessions = new Map<string, SessionState>();
	readonly #connection: acp.AgentSideConnection;
	readonly #config: Config;
	readonly #metadata: Metadata;
	readonly #runtime: AcpAgentRuntime;

	constructor(
		connection: acp.AgentSideConnection,
		config: Config,
		metadata: Metadata,
		runtime: AcpAgentRuntime = DEFAULT_RUNTIME,
	) {
		this.#connection = connection;
		this.#config = config;
		this.#metadata = metadata;
		this.#runtime = runtime;
	}

	initialize(params: acp.InitializeRequest): acp.InitializeResponse {
		return {
			protocolVersion:
				params.protocolVersion === acp.PROTOCOL_VERSION
					? params.protocolVersion
					: acp.PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: false,
				promptCapabilities: {
					image: false,
					audio: false,
					embeddedContext: true,
				},
				mcpCapabilities: { http: false, sse: false },
				sessionCapabilities: {},
			},
			agentInfo: {
				name: "octofriend",
				title: "Octofriend",
				version: this.#metadata.version,
			},
			authMethods: [],
		};
	}

	authenticate(): acp.AuthenticateResponse {
		return {};
	}

	newSession(params: acp.NewSessionRequest): acp.NewSessionResponse {
		if (!path.isAbsolute(params.cwd)) {
			throw acp.RequestError.invalidParams(
				undefined,
				"session/new cwd must be an absolute path",
			);
		}
		if (params.mcpServers.length > 0) {
			throw acp.RequestError.invalidParams(
				undefined,
				"ACP-provided mcpServers are not supported; configure MCP servers in octofriend.",
			);
		}
		const model = this.#defaultModel();
		const id = randomUUID();
		this.#sessions.set(id, {
			id,
			cwd: path.resolve(params.cwd),
			transport: new LocalTransport(path.resolve(params.cwd)),
			messages: [],
			selectedModelId: model.nickname,
			allowAlways: new Set(),
			rejectAlways: new Set(),
			pendingPrompt: null,
		});
		return {
			sessionId: id,
			configOptions: this.#modelConfigOptions(model.nickname),
		};
	}

	async setSessionConfigOption(
		params: acp.SetSessionConfigOptionRequest,
	): Promise<acp.SetSessionConfigOptionResponse> {
		const session = this.#requireSession(params.sessionId);
		if (
			params.configId !== MODEL_CONFIG_ID ||
			typeof params.value !== "string"
		) {
			throw acp.RequestError.invalidParams(
				undefined,
				`Unsupported config option: ${params.configId}`,
			);
		}
		const model = this.#findModel(params.value);
		if (!model) {
			throw acp.RequestError.invalidParams(
				undefined,
				`Unknown model: ${params.value}`,
			);
		}
		session.selectedModelId = model.nickname;
		const configOptions = this.#modelConfigOptions(model.nickname);
		await this.#connection.sessionUpdate({
			sessionId: session.id,
			update: { sessionUpdate: "config_option_update", configOptions },
		});
		return { configOptions };
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		const session = this.#requireSession(params.sessionId);
		if (session.pendingPrompt) {
			throw acp.RequestError.invalidParams(
				undefined,
				"A prompt is already running for this session",
			);
		}
		const text = promptContentToText(params.prompt);
		session.messages.push({
			role: "user",
			messageId: randomUUID(),
			content: [{ type: "text", content: text }],
		} as unknown);

		const abortController = new AbortController();
		session.pendingPrompt = abortController;
		let bridge: AgentdRustBridge | null = null;
		let liveUpdate: ((update: acp.SessionUpdate) => void) | null = null;
		try {
			const activeBridge = await this.#runtime.createBridge({
				onNotification: (notification) => {
					const update = sessionUpdateFromAgentdNotification(notification);
					if (update) liveUpdate?.(update);
				},
			});
			bridge = activeBridge;
			while (!abortController.signal.aborted) {
				const model = this.#modelForSession(session);
				const apiKey = await this.#runtime.assertKeyForModel(
					model,
					this.#config,
				);
				let updates = Promise.resolve();
				let updateError: unknown;
				let receivedLiveTokens = false;
				const enqueue = (update: acp.SessionUpdate) => {
					updates = updates.then(async () => {
						if (updateError) return;
						try {
							await this.#connection.sessionUpdate({
								sessionId: session.id,
								update,
							});
						} catch (error) {
							updateError = error;
						}
					});
				};

				liveUpdate = (update) => {
					receivedLiveTokens = true;
					enqueue(update);
				};
				const finish = await this.#runtime.trajectoryArc({
					apiKey,
					model,
					messages: session.messages,
					config: this.#config,
					transport: session.transport,
					abortSignal: abortController.signal,
					trajectoryArcRun: (request, options) =>
						activeBridge.trajectoryArc(request, {
							abortSignal: options?.abortSignal,
							cancelOnAbort: true,
						}),
					handler: {
						startResponse: ignoreEvent,
						startCompaction: ignoreEvent,
						compactionProgress: ignoreEvent,
						compactionParsed: ignoreEvent,
						providerMetrics: ignoreEvent,
						autofixingJson: ignoreEvent,
						autofixingDiff: ignoreEvent,
						retryTool: ignoreEvent,
						onQuotaUpdated: ignoreEvent,
						responseProgress: ({ delta }) => {
							if (
								receivedLiveTokens ||
								delta.value.length === 0 ||
								delta.type === "tool"
							)
								return;
							enqueue({
								sessionUpdate:
									delta.type === "reasoning"
										? "agent_thought_chunk"
										: "agent_message_chunk",
								content: { type: "text", text: delta.value },
							});
						},
					},
				});
				liveUpdate = null;
				await updates;
				if (updateError) throw updateError;
				session.messages.push(...finish.irs);

				const response = await this.#handleFinish(
					session,
					finish,
					activeBridge,
					abortController.signal,
				);
				if (response) return response;
			}
			return { stopReason: "cancelled" };
		} catch (error) {
			if (abortController.signal.aborted) return { stopReason: "cancelled" };
			throw error;
		} finally {
			liveUpdate = null;
			bridge?.close();
			session.pendingPrompt = null;
		}
	}

	cancel(params: acp.CancelNotification): void {
		this.#requireSession(params.sessionId).pendingPrompt?.abort();
	}

	async closeSession(params: acp.CloseSessionRequest): Promise<void> {
		const session = this.#requireSession(params.sessionId);
		session.pendingPrompt?.abort();
		await session.transport.close();
		this.#sessions.delete(params.sessionId);
	}

	async #handleFinish(
		session: SessionState,
		finish: Finish,
		bridge: AgentdRustBridge,
		signal: AbortSignal,
	): Promise<acp.PromptResponse | null> {
		switch (finish.reason.type) {
			case "abort":
				return { stopReason: "cancelled" };
			case "needs-response":
				return { stopReason: "end_turn" };
			case "request-tool":
				for (const toolCall of finish.reason.toolCalls) {
					const decision = await this.#runTool(
						session,
						toolCall,
						bridge,
						signal,
					);
					if (decision === "cancelled") {
						return { stopReason: "cancelled" };
					}
				}
				return null;
			default:
				throw acp.RequestError.internalError(
					{ curl: finish.reason.curl },
					finish.reason.requestError,
				);
		}
	}

	async #runTool(
		session: SessionState,
		toolCall: ToolCallRequest,
		bridge: AgentdRustBridge,
		signal: AbortSignal,
	): Promise<"continue" | "cancelled"> {
		const call = toAcpToolCall(toolCall, session.cwd, "pending");
		await this.#connection.sessionUpdate({
			sessionId: session.id,
			update: { sessionUpdate: "tool_call", ...call },
		});
		const permission = await this.#permission(session, toolCall, call, signal);
		if (permission === "cancelled") return "cancelled";
		if (permission === "reject") {
			session.messages.push({
				role: "tool-reject",
				toolCall,
				rejectedByUserMessageId: randomUUID(),
			} as unknown);
			await this.#toolUpdate(
				session.id,
				toolCall.toolCallId,
				"failed",
				"Tool call rejected by user.",
			);
			return "continue";
		}

		await this.#connection.sessionUpdate({
			sessionId: session.id,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId: toolCall.toolCallId,
				status: "in_progress",
			},
		});
		const loaded = await this.#runtime.loadTools(
			session.transport,
			signal,
			this.#config,
			{
				skillDiscover: (request) => bridge.skillDiscover(request),
				toolDefinitions: (request) => bridge.toolDefinitions(request),
			},
		);
		const result = loaded.success
			? await this.#runtime.runTool({
					abortSignal: signal,
					transport: session.transport,
					loaded: loaded.data,
					call: toolCall,
					config: this.#config,
					toolRun: (request, options) => bridge.toolRun(request, options),
				})
			: { success: false as const, error: loaded.error };
		if (signal.aborted) return "cancelled";
		if (!result.success) {
			session.messages.push({
				role: "tool-runtime-error",
				toolCall,
				error: result.error,
			} as unknown);
			await this.#toolUpdate(
				session.id,
				toolCall.toolCallId,
				"failed",
				result.error,
			);
			return "continue";
		}
		session.messages.push(toolRunResultToIr(result.data, toolCall));
		const output = toolResultText(result.data);
		await this.#toolUpdate(
			session.id,
			toolCall.toolCallId,
			"completed",
			output,
		);
		return "continue";
	}

	async #permission(
		session: SessionState,
		toolCall: ToolCallRequest,
		call: Omit<acp.ToolCall, "sessionUpdate">,
		signal: AbortSignal,
	): Promise<PermissionDecision> {
		const key = `${toolCall.name}:\0${JSON.stringify(toolCall.parsed)}`;
		if (session.rejectAlways.has(key)) return "reject";
		if (session.allowAlways.has(key)) return "allow";
		const response = await this.#connection.requestPermission({
			sessionId: session.id,
			toolCall: call,
			options: [
				{ optionId: "allow_once", kind: "allow_once", name: "Allow once" },
				{
					optionId: "allow_always",
					kind: "allow_always",
					name: "Allow always",
				},
				{ optionId: "reject_once", kind: "reject_once", name: "Reject once" },
				{
					optionId: "reject_always",
					kind: "reject_always",
					name: "Reject always",
				},
			],
		});
		if (signal.aborted || response.outcome.outcome === "cancelled")
			return "cancelled";
		if (response.outcome.optionId === "allow_always") {
			session.allowAlways.add(key);
			return "allow";
		}
		if (response.outcome.optionId === "allow_once") return "allow";
		if (response.outcome.optionId === "reject_always")
			session.rejectAlways.add(key);
		return "reject";
	}

	async #toolUpdate(
		sessionId: string,
		toolCallId: string,
		status: acp.ToolCallStatus,
		text: string,
	): Promise<void> {
		await this.#connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "tool_call_update",
				toolCallId,
				status,
				content: [{ type: "content", content: { type: "text", text } }],
				rawOutput: { text },
			},
		});
	}

	#requireSession(id: string): SessionState {
		const session = this.#sessions.get(id);
		if (!session) throw acp.RequestError.resourceNotFound(`session:${id}`);
		return session;
	}

	#defaultModel(): ModelConfig {
		const model = this.#config.models[0];
		if (!model)
			throw acp.RequestError.internalError(undefined, "No model configured");
		return model;
	}

	#findModel(id: string): ModelConfig | null {
		return this.#config.models.find((model) => model.nickname === id) ?? null;
	}

	#modelForSession(session: SessionState): ModelConfig {
		return this.#findModel(session.selectedModelId) ?? this.#defaultModel();
	}

	#modelConfigOptions(currentValue: string): acp.SessionConfigOption[] {
		return [
			{
				id: MODEL_CONFIG_ID,
				type: "select",
				category: "model",
				name: "Model",
				description: "Select the model used for this ACP session",
				currentValue,
				options: this.#config.models.map((model) => ({
					value: model.nickname,
					name: model.nickname,
					description: model.model,
				})),
			},
		];
	}
}

function sessionUpdateFromAgentdNotification(notification: {
	method: string;
	params?: unknown;
}): acp.SessionUpdate | null {
	if (
		notification.method !== "octofriend.agentd/trajectoryEvent" ||
		typeof notification.params !== "object" ||
		notification.params === null
	)
		return null;
	const envelope = notification.params as { event?: unknown };
	if (typeof envelope.event !== "object" || envelope.event === null)
		return null;
	const streamed = envelope.event as {
		type?: unknown;
		phase?: unknown;
		event?: unknown;
	};
	if (
		streamed.type !== "provider-event" ||
		streamed.phase !== "response" ||
		typeof streamed.event !== "object" ||
		streamed.event === null
	)
		return null;
	const event = streamed.event as {
		type?: unknown;
		kind?: unknown;
		text?: unknown;
	};
	if (
		event.type !== "token" ||
		(event.kind !== "content" && event.kind !== "reasoning") ||
		typeof event.text !== "string" ||
		event.text.length === 0
	)
		return null;
	return {
		sessionUpdate:
			event.kind === "reasoning"
				? "agent_thought_chunk"
				: "agent_message_chunk",
		content: { type: "text", text: event.text },
	};
}

function promptContentToText(prompt: acp.ContentBlock[]): string {
	const parts: string[] = [];
	for (const block of prompt) {
		if (block.type === "text") {
			parts.push(block.text);
		} else if (block.type === "resource_link") {
			parts.push(`[resource: ${block.name}] ${block.uri}`);
		} else if (block.type === "resource") {
			const resource = block.resource;
			parts.push(
				"text" in resource
					? `[resource: ${resource.uri}]\n${resource.text}`
					: `[resource: ${resource.uri}] (binary content omitted)`,
			);
		} else {
			throw acp.RequestError.invalidParams(
				undefined,
				`Unsupported prompt content: ${block.type}`,
			);
		}
	}
	return parts.join("\n\n").trim();
}

function toAcpToolCall(
	call: ToolCallRequest,
	cwd: string,
	status: acp.ToolCallStatus,
): Omit<acp.ToolCall, "sessionUpdate"> {
	const file =
		typeof call.parsed["filePath"] === "string"
			? path.resolve(cwd, call.parsed["filePath"])
			: null;
	return {
		toolCallId: call.toolCallId,
		title: toolTitle(call),
		kind: toolKind(call.name),
		status,
		locations: file ? [{ path: file }] : [],
		rawInput: call.parsed,
	};
}

function toolTitle(call: ToolCallRequest): string {
	const file = call.parsed["filePath"];
	if (typeof file === "string") return `${call.name}: ${file}`;
	const command = call.parsed["command"] ?? call.parsed["cmd"];
	if (typeof command === "string") return `Run: ${command.slice(0, 120)}`;
	return call.name;
}

function toolKind(name: string): acp.ToolKind {
	if (name === "read" || name === "list") return "read";
	if (name === "edit" || name === "rewrite" || name === "create") return "edit";
	if (name === "shell") return "execute";
	if (name === "grep" || name === "glob" || name === "web-search")
		return "search";
	if (name === "fetch") return "fetch";
	return "other";
}

function toolRunResultToIr(
	result: ToolRunResult,
	toolCall: ToolCallRequest,
): unknown {
	if (result.type === "custom-ir") return result.data;
	if (result.type === "invoke-subagent") {
		return {
			role: "tool-runtime-error",
			toolCall,
			error: `Subagent invocation is not supported in ACP mode: ${result.name}`,
		};
	}
	return { role: "tool-output", toolCall, content: result.content };
}

function toolResultText(
	result: Awaited<ReturnType<typeof runTool>> extends infer _ ? unknown : never,
): string {
	if (typeof result !== "object" || result === null) return String(result);
	const typed = result as {
		type?: string;
		content?: Array<{ type?: string; content?: string }>;
	};
	if (typed.type !== "output" || !typed.content) return JSON.stringify(result);
	return typed.content
		.filter((item) => item.type === "text")
		.map((item) => item.content ?? "")
		.join("\n");
}
