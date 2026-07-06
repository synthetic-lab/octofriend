import { describe, expect, it } from "bun:test";
import { AgentdProcessClient } from "../../../bridge/process/client.ts";
import { AgentdJsonRpcError } from "../../../bridge/process/errors.ts";
import { createAgentdRequest } from "../../../bridge/process/events.ts";

type FakeProcess = {
	stdin: WritableStream<Uint8Array>;
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	killed: boolean;
	kill: () => void;
};

function createFakeAgentdProcess(
	handleRequest: (request: unknown) => unknown,
): FakeProcess {
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	let stdoutController: ReadableStreamDefaultController<Uint8Array>;
	let buffer = "";
	const stdout = new ReadableStream<Uint8Array>({
		start(controller) {
			stdoutController = controller;
		},
	});
	const stderr = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.close();
		},
	});
	const fake: FakeProcess = {
		stdin: new WritableStream<Uint8Array>({
			write(chunk) {
				buffer += decoder.decode(chunk, { stream: true });
				let newlineIndex = buffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);
					if (line.length > 0) {
						stdoutController.enqueue(
							encoder.encode(
								`${JSON.stringify(handleRequest(JSON.parse(line)))}\n`,
							),
						);
					}
					newlineIndex = buffer.indexOf("\n");
				}
			},
		}),
		stdout,
		stderr,
		killed: false,
		kill() {
			fake.killed = true;
			stdoutController.close();
		},
	};
	return fake;
}

describe("AgentdProcessClient", () => {
	it("creates JSON-RPC requests with incrementing numeric ids", () => {
		expect(createAgentdRequest(7, "octofwen.agentd/initialize")).toEqual({
			jsonrpc: "2.0",
			id: 7,
			method: "octofwen.agentd/initialize",
		});
		expect(createAgentdRequest(8, "method", { ok: true })).toEqual({
			jsonrpc: "2.0",
			id: 8,
			method: "method",
			params: { ok: true },
		});
	});

	it("sends JSONL requests and resolves matching responses", async () => {
		const process = createFakeAgentdProcess((request) => ({
			jsonrpc: "2.0",
			id: (request as { id: number }).id,
			result: { method: (request as { method: string }).method },
		}));
		const client = new AgentdProcessClient(process);

		await expect(client.request("octofwen.agentd/initialize")).resolves.toEqual(
			{
				method: "octofwen.agentd/initialize",
			},
		);
		await expect(
			client.request("octofwen.agentd/renderToolCall"),
		).resolves.toEqual({
			method: "octofwen.agentd/renderToolCall",
		});

		client.close();
		expect(process.killed).toBe(true);
	});

	it("rejects JSON-RPC error responses", async () => {
		const process = createFakeAgentdProcess((request) => ({
			jsonrpc: "2.0",
			id: (request as { id: number }).id,
			error: { code: -32601, message: "Method not found" },
		}));
		const client = new AgentdProcessClient(process);

		const rejected = client.request("missing");
		await expect(rejected).rejects.toBeInstanceOf(AgentdJsonRpcError);

		const rejectedWithShape = client.request("missing");
		await expect(rejectedWithShape).rejects.toMatchObject({
			code: -32601,
			message: "Method not found",
		});
		client.close();
	});

	it("matches responses by request id across multiple requests", async () => {
		const process = createFakeAgentdProcess((request) => ({
			jsonrpc: "2.0",
			id: (request as { id: number }).id,
			result: { id: (request as { id: number }).id },
		}));
		const client = new AgentdProcessClient(process);

		await expect(client.request("first")).resolves.toEqual({ id: 1 });
		await expect(client.request("second")).resolves.toEqual({ id: 2 });
		client.close();
	});

	it("kills the agentd process when a cancellable request is aborted", async () => {
		let stdoutController: ReadableStreamDefaultController<Uint8Array>;
		const process: FakeProcess = {
			stdin: new WritableStream<Uint8Array>(),
			stdout: new ReadableStream<Uint8Array>({
				start(controller) {
					stdoutController = controller;
				},
			}),
			stderr: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close();
				},
			}),
			killed: false,
			kill() {
				process.killed = true;
				stdoutController.close();
			},
		};
		const client = new AgentdProcessClient(process);
		const abortController = new AbortController();
		const request = client.request("slow", undefined, {
			abortSignal: abortController.signal,
			cancelOnAbort: true,
		});

		abortController.abort();

		await expect(request).rejects.toThrow("agentd request aborted");
		expect(process.killed).toBe(true);
	});
});
