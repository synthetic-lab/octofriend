import { describe, expect, it } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import type { Config } from "@octofriend/tui/acp-runtime";
import {
	type AcpAgentRuntime,
	OctofriendAcpAgent,
} from "../../src/acp/agent.ts";

const config: Config = {
	yourName: "Ada",
	models: [
		{
			type: "standard",
			nickname: "Fast",
			baseUrl: "https://example.test/v1",
			model: "fast",
			context: 1000,
		},
		{
			type: "standard",
			nickname: "Deep",
			baseUrl: "https://example.test/v1",
			model: "deep",
			context: 2000,
		},
	],
};

type FakeConnection = {
	updates: acp.SessionNotification[];
	permissions: acp.RequestPermissionRequest[];
	sessionUpdate: (params: acp.SessionNotification) => Promise<void>;
	requestPermission: (
		params: acp.RequestPermissionRequest,
	) => Promise<acp.RequestPermissionResponse>;
};

function fakeConnection(): FakeConnection {
	const connection: FakeConnection = {
		updates: [],
		permissions: [],
		sessionUpdate: (params) => {
			connection.updates.push(params);
			return Promise.resolve();
		},
		requestPermission: (params) => {
			connection.permissions.push(params);
			return Promise.resolve({
				outcome: { outcome: "selected", optionId: "allow_once" },
			});
		},
	};
	return connection;
}

function fakeBridge() {
	return {
		close: () => undefined,
		skillDiscover: async () => ({ skills: [] }),
		toolDefinitions: async () => ({ tools: [] }),
		toolRun: async () => ({ status: "completed", result: {} }),
	};
}

type BridgeOptions = NonNullable<
	Parameters<AcpAgentRuntime["createBridge"]>[0]
>;
type AgentdNotification = Parameters<
	NonNullable<BridgeOptions["onNotification"]>
>[0];

function runtime(
	trajectory: (
		params: Parameters<AcpAgentRuntime["trajectoryArc"]>[0],
	) => ReturnType<AcpAgentRuntime["trajectoryArc"]>,
	liveNotification?: AgentdNotification,
): AcpAgentRuntime {
	let notify: BridgeOptions["onNotification"];
	return {
		createBridge: (options) => {
			notify = options?.onNotification;
			return Promise.resolve(fakeBridge() as never);
		},
		assertKeyForModel: () => Promise.resolve("test-key"),
		trajectoryArc: ((params) => {
			if (liveNotification) notify?.(liveNotification);
			return trajectory(params);
		}) as AcpAgentRuntime["trajectoryArc"],
		loadTools: (async () => ({
			success: true,
			data: {},
		})) as unknown as AcpAgentRuntime["loadTools"],
		runTool: (async () => ({
			success: true,
			data: {
				type: "output",
				content: [{ type: "text", content: "tool output" }],
			},
		})) as unknown as AcpAgentRuntime["runTool"],
	};
}

async function createSession(
	agent: OctofriendAcpAgent,
): Promise<acp.NewSessionResponse> {
	return await agent.newSession({
		cwd: process.cwd(),
		mcpServers: [],
	});
}

describe("ACP adapter", () => {
	it("negotiates ACP, exposes model selection, and streams standard prompts", async () => {
		const connection = fakeConnection();
		const selectedModels: string[] = [];
		const agent = new OctofriendAcpAgent(
			connection as unknown as acp.AgentSideConnection,
			config,
			{ version: "1.2.3" },
			runtime((params) => {
				selectedModels.push(params.model.nickname);
				params.handler.responseProgress({
					buffer: { content: "hello" },
					delta: { type: "content", value: "hello" },
				});
				return Promise.resolve({
					type: "finish" as const,
					irs: [],
					reason: { type: "needs-response" as const },
				});
			}),
		);

		expect(
			agent.initialize({ protocolVersion: acp.PROTOCOL_VERSION }),
		).toMatchObject({
			protocolVersion: acp.PROTOCOL_VERSION,
			agentInfo: { name: "octofriend", version: "1.2.3" },
		});
		const session = await createSession(agent);
		expect(session.configOptions?.[0]).toMatchObject({
			id: "model",
			currentValue: "Fast",
		});
		await agent.setSessionConfigOption({
			sessionId: session.sessionId,
			configId: "model",
			value: "Deep",
		});
		const response = await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{ type: "text", text: "hi" }],
		});
		expect(response).toEqual({ stopReason: "end_turn" });
		expect(selectedModels).toEqual(["Deep"]);
		expect(connection.updates).toContainEqual({
			sessionId: session.sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "hello" },
			},
		});
	});

	it("forwards live agentd tokens and suppresses their buffered duplicate", async () => {
		const connection = fakeConnection();
		const agent = new OctofriendAcpAgent(
			connection as unknown as acp.AgentSideConnection,
			config,
			{ version: "1.0.0" },
			runtime(
				(params) => {
					params.handler.responseProgress({
						buffer: { content: "live" },
						delta: { type: "content", value: "live" },
					});
					return Promise.resolve({
						type: "finish" as const,
						irs: [],
						reason: { type: "needs-response" as const },
					});
				},
				{
					method: "octofriend.agentd/trajectoryEvent",
					params: {
						event: {
							type: "provider-event",
							phase: "response",
							event: { type: "token", kind: "content", text: "live" },
						},
					},
				},
			),
		);
		const session = await createSession(agent);

		await agent.prompt({
			sessionId: session.sessionId,
			prompt: [{ type: "text", text: "stream" }],
		});
		expect(
			connection.updates.filter(
				(update) => update.update.sessionUpdate === "agent_message_chunk",
			),
		).toEqual([
			{
				sessionId: session.sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "live" },
				},
			},
		]);
	});

	it("round-trips tool permissions and reports tool lifecycle updates", async () => {
		const connection = fakeConnection();
		let calls = 0;
		const agent = new OctofriendAcpAgent(
			connection as unknown as acp.AgentSideConnection,
			config,
			{ version: "1.0.0" },
			runtime(() => {
				calls += 1;
				if (calls === 1) {
					return Promise.resolve({
						type: "finish" as const,
						irs: [],
						reason: {
							type: "request-tool" as const,
							toolCalls: [
								{
									type: "tool-call",
									name: "read",
									toolCallId: "call-1",
									parsed: { filePath: "README.md" },
									original: { filePath: "README.md" },
								},
							],
						},
					});
				}
				return Promise.resolve({
					type: "finish" as const,
					irs: [],
					reason: { type: "needs-response" as const },
				});
			}),
		);
		const session = await createSession(agent);
		expect(
			await agent.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "read it" }],
			}),
		).toEqual({ stopReason: "end_turn" });
		expect(connection.permissions).toHaveLength(1);
		expect(connection.permissions[0]?.toolCall.toolCallId).toBe("call-1");
		expect(
			connection.updates.map(
				(notification) => notification.update.sessionUpdate,
			),
		).toContain("tool_call");
		expect(connection.updates).toContainEqual({
			sessionId: session.sessionId,
			update: expect.objectContaining({
				sessionUpdate: "tool_call_update",
				toolCallId: "call-1",
				status: "completed",
			}),
		});
	});

	it("cancels an active prompt without closing the ACP connection", async () => {
		const connection = fakeConnection();
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const agent = new OctofriendAcpAgent(
			connection as unknown as acp.AgentSideConnection,
			config,
			{ version: "1.0.0" },
			runtime(
				async ({ abortSignal }) =>
					await new Promise((_, reject) => {
						markStarted?.();
						abortSignal.addEventListener(
							"abort",
							() => reject(new Error("aborted")),
							{ once: true },
						);
					}),
			),
		);
		const session = await createSession(agent);
		const pending = agent.prompt({
			sessionId: session.sessionId,
			prompt: [{ type: "text", text: "wait" }],
		});
		await started;
		agent.cancel({ sessionId: session.sessionId });
		expect(await pending).toEqual({ stopReason: "cancelled" });

		// A cancelled turn releases the session for another prompt.
		agent.cancel({ sessionId: session.sessionId });
		await agent.closeSession({ sessionId: session.sessionId });
		await expect(
			agent.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "closed" }],
			}),
		).rejects.toThrow();
	});
});
