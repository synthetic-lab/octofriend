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
				? await runTool({
						abortSignal: abortController.signal,
						transport: transport,
						loaded: tools.data,
						call: toolReq,
						config: config,
						toolRun: toolRun,
					})
				: err(tools.error);
			const toolIr = result.success
				? toolRunResultToIR(result.data, toolReq)
				: result;
			if (toolIr.success) {
				appendToolHistoryItem(set, get, {
					type: "llm-ir",
					ir: toolIr.data,
				});
			} else {
				appendToolHistoryItem(set, get, {
					type: "llm-ir",
					ir: {
						role: "tool-runtime-error",
						error: toolIr.error,
						toolCall: toolReq,
					},
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

function appendToolHistoryItem(
	set: AppStateSet,
	get: AppStateGet,
	item: ReturnType<AppStateGet>["history"][number],
): void {
	const history = get().history;
	const nextHistory = new Array<ReturnType<AppStateGet>["history"][number]>(
		history.length + 1,
	);
	for (let index = 0; index < history.length; index += 1) {
		nextHistory[index] = history[
			index
		] as ReturnType<AppStateGet>["history"][number];
	}
	nextHistory[history.length] = item;
	set({ history: nextHistory });
}

function appendToolRuntimeError(
	set: AppStateSet,
	get: AppStateGet,
	toolReq: Parameters<UiState["runTool"]>[0]["toolReq"],
	error: string,
) {
	appendToolHistoryItem(set, get, {
		type: "llm-ir",
		ir: {
			role: "tool-runtime-error",
			error,
			toolCall: toolReq,
		},
	});
}
