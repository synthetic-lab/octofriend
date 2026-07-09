import { describe, expect, it } from "bun:test";
import {
	AgentdBridgeResponseError,
	invalidAgentdInitializeResponseError,
	invalidAgentdToolRenderResponseError,
} from "../../../src/bridge/agent/errors";

describe("AgentdBridgeResponseError", () => {
	it("names invalid bridge response errors", () => {
		const error = new AgentdBridgeResponseError("Invalid response");

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("AgentdBridgeResponseError");
		expect(error.message).toBe("Invalid response");
	});

	it("creates initialize validation errors with the existing message", () => {
		expect(invalidAgentdInitializeResponseError()).toMatchObject({
			name: "AgentdBridgeResponseError",
			message: "Invalid octofwen-agentd initialize response",
		});
	});

	it("creates tool render validation errors with the existing message", () => {
		expect(invalidAgentdToolRenderResponseError()).toMatchObject({
			name: "AgentdBridgeResponseError",
			message: "Invalid octofwen-agentd tool render response",
		});
	});
});
