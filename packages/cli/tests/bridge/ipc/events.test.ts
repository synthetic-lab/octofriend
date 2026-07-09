import { describe, expect, it } from "bun:test";
import { createAgentdRequest } from "../../../src/bridge/ipc/events";

describe("createAgentdRequest", () => {
	it("creates JSON-RPC requests without params", () => {
		expect(createAgentdRequest(7, "octofwen.agentd/initialize")).toEqual({
			jsonrpc: "2.0",
			id: 7,
			method: "octofwen.agentd/initialize",
		});
	});

	it("creates JSON-RPC requests with params", () => {
		expect(createAgentdRequest(8, "method", { ok: true })).toEqual({
			jsonrpc: "2.0",
			id: 8,
			method: "method",
			params: { ok: true },
		});
	});
});

describe("process client exports", () => {
	it("does not re-export JSON-RPC event helpers from the client owner", async () => {
		const clientModule = await import("../../../src/bridge/ipc/client");

		expect("createAgentdRequest" in clientModule).toBe(false);
	});
});
