import { describe, expect, it } from "bun:test";
import {
	BuiltInToolContracts,
	type OctoIR,
	octoAgent,
} from "../../../internal/octo-agent-ir/main.ts";

describe("Octo agent IR", () => {
	it("binds the Octo agent to the built-in tool map with no subagents", () => {
		expect(octoAgent.tools).toBe(BuiltInToolContracts);
		expect(octoAgent.agents).toEqual({});
	});

	it("includes rejected tool calls in the Octo IR union", () => {
		const rejected = {
			role: "tool-reject",
			toolCall: {
				type: "tool-call",
				name: "shell",
				toolCallId: "call_1",
				original: { cmd: "pwd", timeout: 1000 },
				parsed: { cmd: "pwd", timeout: 1000 },
			},
		} satisfies OctoIR;

		expect(rejected.role).toBe("tool-reject");
	});
});
