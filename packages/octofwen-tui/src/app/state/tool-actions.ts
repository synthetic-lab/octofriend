import { loadTools, runTool } from "../../internal/tool-orchestration/main.ts";
import { toolRunResultToIR } from "./tool-results.ts";
import type { AppStateGet, AppStateSet, UiState } from "./types.ts";

export function createToolActions(set: AppStateSet, get: AppStateGet) {
	return {
		runTool: async ({
			config,
			toolReq,
			transport,
			skillDiscover,
			toolDefinitions,
			toolRun,
		}) => {
			let { modeData } = get();
			if (modeData.mode !== "tool-call") {
				throw new Error(`Impossible tool mode: ${modeData.mode}`);
			}
			if (modeData.runningToolCallId != null) {
				if (process.env["OCTOFWEN_CHANNEL"] === "canary") {
					throw new Error(
						"Canary build error: attempted to run a tool when a tool was already running",
					);
				}
			}

			const abortController = modeData.abortController;
			set({ modeData: { ...modeData, runningToolCallId: toolReq.toolCallId } });

			const tools = await loadTools(transport, abortController.signal, config, {
				skillDiscover,
				toolDefinitions,
			});

			const result = await runTool(
				abortController.signal,
				transport,
				tools,
				toolReq,
				config,
				toolRun,
			);
			if (result.success) {
				set({
					history: [
						...get().history,
						{
							type: "llm-ir",
							ir: toolRunResultToIR(result.data, toolReq),
						},
					],
				});
			} else {
				set({
					history: [
						...get().history,
						{
							type: "llm-ir",
							ir: {
								role: "tool-runtime-error",
								error: result.error,
								toolCall: toolReq,
							},
						},
					],
				});
			}

			if (get()._maybeHandleAbort(abortController.signal)) {
				return;
			}

			({ modeData } = get());
			if (modeData.mode === "tool-call") {
				set({ modeData: { ...modeData, runningToolCallId: null } });
			}
		},
	} satisfies Pick<UiState, "runTool">;
}
