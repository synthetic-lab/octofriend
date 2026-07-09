import { describe, expect, it } from "bun:test";
import { AgentdJsonRpcError } from "../../../src/bridge/ipc/errors";

describe("AgentdJsonRpcError", () => {
	it("preserves JSON-RPC error code and data", () => {
		const error = new AgentdJsonRpcError({
			code: -32601,
			message: "Method not found",
			data: { method: "missing" },
		});

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("AgentdJsonRpcError");
		expect(error.message).toBe("Method not found");
		expect(error.code).toBe(-32601);
		expect(error.data).toEqual({ method: "missing" });
	});
});

describe("process client exports", () => {
	it("does not re-export JSON-RPC errors from the client owner", async () => {
		const clientModule = await import("../../../src/bridge/ipc/client");

		expect("AgentdJsonRpcError" in clientModule).toBe(false);
	});
});
