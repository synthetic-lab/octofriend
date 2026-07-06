import type { OctoIR } from "../../internal/octo-agent-ir/main.ts";
import type { ToolRunResult } from "../../internal/tool-orchestration/main.ts";
import { err, ok, type Result } from "../result.ts";
import type { ToolCallRequest } from "./types.ts";

export function toolRunResultToIR(
	result: ToolRunResult,
	toolCall: ToolCallRequest,
): Result<OctoIR, string> {
	if (result.type === "custom-ir") {
		return ok(result.data as OctoIR);
	}

	if (result.type === "invoke-subagent") {
		return err(
			`Subagent invocation is not supported in Octo tools: ${result.name}`,
		);
	}

	return ok({
		role: "tool-output",
		toolCall,
		content: result.content,
	});
}
