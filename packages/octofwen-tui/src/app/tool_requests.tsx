import { Box } from "ink";
import { useCallback, useEffect, useState } from "react";
import {
	preflightToolCall,
	type ToolCall as ToolCallRequest,
} from "../internal/tool-orchestration/main.ts";
import { ToolMessageRenderer } from "../rendering/tools.tsx";
import { Loading } from "./loading.tsx";
import { useAppStore } from "./state/store.ts";
import type { UiState } from "./state/types.ts";
import {
	selectIsRunningToolCall as selectIsRunningToolCallImpl,
	ToolRequestRenderer as ToolRequestRendererComponent,
} from "./tool_request_renderer.tsx";
import {
	type FinishToolRequestsProps,
	type TerminalToolRequestsProps,
	TOOL_REQUEST_LOADING_STRINGS,
	TOOL_REQUEST_PREPARE_ERROR as TOOL_REQUEST_PREPARE_ERROR_VALUE,
} from "./tool_request_types.ts";

export type {
	FinishToolRequestsProps,
	TerminalToolRequestProps,
	TerminalToolRequestsProps,
	ToolRequestSelectItem,
} from "./tool_request_types.ts";
export const TOOL_REQUEST_PREPARE_ERROR = TOOL_REQUEST_PREPARE_ERROR_VALUE;
export const ToolRequestRenderer = ToolRequestRendererComponent;
export const selectIsRunningToolCall = selectIsRunningToolCallImpl;

const toolRequestsRunAgentSelector = (state: UiState) => state.runAgent;

export function ToolRequestsRenderer({
	toolReqs,
	config,
	transport,
	trajectoryArcRun,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
}: TerminalToolRequestsProps) {
	const runAgent = useAppStore(toolRequestsRunAgentSelector);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [preflightedCurrentToolReq, setPreflightedCurrentToolReq] =
		useState<ToolCallRequest | null>(null);
	const currentToolReq = toolReqs[currentIndex] ?? null;
	const onDone = useCallback(() => {
		setCurrentIndex((i) => i + 1);
	}, []);

	useEffect(() => {
		let alive = true;
		const controller = new AbortController();
		setPreflightedCurrentToolReq(null);
		if (currentToolReq == null)
			return () => {
				alive = false;
				controller.abort();
			};
		preflightToolCall(controller.signal, transport, currentToolReq).then(
			(preflight) => {
				if (alive) {
					setPreflightedCurrentToolReq(
						preflight.success ? preflight.data : currentToolReq,
					);
				}
			},
			() => {
				if (alive) setPreflightedCurrentToolReq(currentToolReq);
			},
		);
		return () => {
			alive = false;
			controller.abort();
		};
	}, [currentToolReq, transport]);

	if (currentIndex >= toolReqs.length) {
		return (
			<FinishToolRequests
				runAgent={runAgent}
				config={config}
				transport={transport}
				trajectoryArcRun={trajectoryArcRun}
				toolPermission={toolPermission}
				skillDiscover={skillDiscover}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
			/>
		);
	}

	if (preflightedCurrentToolReq == null) {
		return <Loading overrideStrings={TOOL_REQUEST_LOADING_STRINGS} />;
	}

	return (
		<Box flexDirection="column">
			<ToolMessageRenderer item={preflightedCurrentToolReq} />
			<ToolRequestRendererComponent
				toolReq={preflightedCurrentToolReq}
				preflighted={true}
				config={config}
				transport={transport}
				trajectoryArcRun={trajectoryArcRun}
				toolPermission={toolPermission}
				skillDiscover={skillDiscover}
				toolDefinitions={toolDefinitions}
				toolRun={toolRun}
				onDone={onDone}
			/>
		</Box>
	);
}

export function FinishToolRequests({
	runAgent,
	config,
	transport,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
}: FinishToolRequestsProps) {
	useEffect(() => {
		runAgent({
			config,
			transport,
			toolPermission,
			skillDiscover,
			toolDefinitions,
			toolRun,
		});
	}, [
		runAgent,
		config,
		transport,
		toolPermission,
		skillDiscover,
		toolDefinitions,
		toolRun,
	]);
	return <Loading />;
}
