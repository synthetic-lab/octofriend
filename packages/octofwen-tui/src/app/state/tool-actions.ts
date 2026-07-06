import { loadTools, runTool } from "../../internal/tool-orchestration/main.ts";
import { err } from "../result.ts";
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
				appendToolRuntimeError(
					set,
					get,
					toolReq,
					`Impossible tool mode: ${modeData.mode}`,
				);
				return;
			}
			if (shouldRejectConcurrentToolRun(modeData)) {
				appendToolRuntimeError(
					set,
					get,
					toolReq,
					"Canary build error: attempted to run a tool when a tool was already running",
				);
				return;
			}

			const abortController = modeData.abortController;
			set({ modeData: { ...modeData, runningToolCallId: toolReq.toolCallId } });

			const tools = await loadTools(transport, abortController.signal, config, {
				skillDiscover,
				toolDefinitions,
			});

			const result = tools.success
				? await runTool(
						abortController.signal,
						transport,
						tools.data,
						toolReq,
						config,
						toolRun,
					)
				: err(tools.error);
			const toolIr = result.success
				? toolRunResultToIR(result.data, toolReq)
				: result;
			if (toolIr.success) {
				set({
					history: [
						...get().history,
						{
							type: "llm-ir",
							ir: toolIr.data,
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
								error: toolIr.error,
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

function shouldRejectConcurrentToolRun(modeData: UiState["modeData"]): boolean {
	return (
		modeData.mode === "tool-call" &&
		modeData.runningToolCallId != null &&
		process.env["OCTOFWEN_CHANNEL"] === "canary"
	);
}

function appendToolRuntimeError(
	set: AppStateSet,
	get: AppStateGet,
	toolReq: Parameters<UiState["runTool"]>[0]["toolReq"],
	error: string,
) {
	set({
		history: [
			...get().history,
			{
				type: "llm-ir",
				ir: {
					role: "tool-runtime-error",
					error,
					toolCall: toolReq,
				},
			},
		],
	});
}
