import type { OctoIR } from "../../runtime/agent/ir/main";
import type { ToolRunResult } from "../../runtime/tools/main";
import { err, ok, type Result } from "../result";
import type { ToolCallRequest } from "./types";

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
