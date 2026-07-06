import type { OctoIR } from "../../internal/octo-agent-ir/main.ts";
import type { ToolRunResult } from "../../internal/tool-orchestration/main.ts";
import type { ToolCallRequest } from "./types.ts";

export function toolRunResultToIR(
	result: ToolRunResult,
	toolCall: ToolCallRequest,
): OctoIR {
	if (result.type === "custom-ir") {
		return result.data as OctoIR;
	}

	if (result.type === "invoke-subagent") {
		throw new Error(
			`Subagent invocation is not supported in Octo tools: ${result.name}`,
		);
	}

	return {
		role: "tool-output",
		toolCall,
		content: result.content,
	};
}
