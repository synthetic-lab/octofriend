import { Box, Text } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ToolPermissionResult } from "../runtime/tools/bridge-types";
import {
	preflightToolCall,
	type ToolCall as ToolCallRequest,
} from "../runtime/tools/main";
import {
	ThemedSelectIndicator as IndicatorComponent,
	SelectInput,
} from "../menu/select";
import { normalizeRenderedLineBreaks } from "../render/lines";
import {
	useTerminalThemeColor,
	useTerminalUnchained,
} from "../theme/branding";
import { Loading } from "./loading";
import { useAppStore } from "./state/store";
import type { UiState } from "./state/types";
import {
	ToolRequestItem,
	ToolRequestPrompt,
	toolRequestItems,
} from "./tool-options";
import {
	type TerminalToolRequestProps,
	TOOL_REQUEST_LOADING_STRINGS,
	TOOL_REQUEST_PREPARE_ERROR,
	type ToolRequestSelectItem,
} from "./tool-types";

const toolRequestActionsSelector = (state: UiState) => ({
	runTool: state.runTool,
	rejectTool: state.rejectTool,
	isWhitelisted: state.isWhitelisted,
	addToWhitelist: state.addToWhitelist,
	notifyReadyForInput: state.notifyReadyForInput,
});

export function selectIsRunningToolCall(
	state: Pick<ReturnType<typeof useAppStore.getState>, "modeData">,
	toolCallId: string,
): boolean {
	return (
		state.modeData.mode === "tool-call" &&
		state.modeData.runningToolCallId === toolCallId
	);
}

export function ToolRequestRenderer({
	toolReq,
	config,
	transport,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
	onDone,
	preflighted = false,
}: TerminalToolRequestProps) {
	const themeColor = useTerminalThemeColor();
	const {
		runTool,
		rejectTool,
		isWhitelisted,
		addToWhitelist,
		notifyReadyForInput,
	} = useAppStore(useShallow(toolRequestActionsSelector));
	const unchained = useTerminalUnchained();
	const [permission, setPermission] = useState<ToolPermissionResult | null>(
		null,
	);
	const [preflightedToolReq, setPreflightedToolReq] =
		useState<ToolCallRequest | null>(null);
	const activeToolReq = preflightedToolReq ?? toolReq;
	const whitelistKey = permission?.whitelistKey ?? null;
	const [toolWhitelistCheck, setToolWhitelistCheck] = useState<{
		key: string;
		value: boolean;
	} | null>(null);
	const [requestError, setRequestError] = useState<string | null>(null);
	const autoRunToolCallIdRef = useRef<string | null>(null);
	const selectedToolCallIdRef = useRef<string | null>(null);
	const isToolWhitelisted =
		whitelistKey != null && toolWhitelistCheck?.key === whitelistKey
			? toolWhitelistCheck.value
			: null;

	useEffect(() => {
		if (!toolPermission) return;
		let alive = true;
		const controller = new AbortController();
		setPermission(null);
		setRequestError(null);
		setPreflightedToolReq(preflighted ? toolReq : null);
		(async () => {
			const resolvedToolReq = preflighted
				? toolReq
				: await preflightToolCall(controller.signal, transport, toolReq).then(
						(preflight) => (preflight.success ? preflight.data : toolReq),
					);
			const resolved = await toolPermission({
				toolName: resolvedToolReq.name,
				parsed: resolvedToolReq.parsed,
			});
			if (alive) {
				setPreflightedToolReq(resolvedToolReq);
				setPermission(resolved);
			}
		})().catch(() => {
			if (alive) setRequestError(TOOL_REQUEST_PREPARE_ERROR);
		});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [toolPermission, toolReq, transport, preflighted]);

	useEffect(() => {
		if (whitelistKey == null) {
			setToolWhitelistCheck(null);
			return;
		}
		let alive = true;
		setToolWhitelistCheck(null);
		isWhitelisted(whitelistKey).then(
			(whitelisted) => {
				if (alive)
					setToolWhitelistCheck({ key: whitelistKey, value: whitelisted });
			},
			() => {
				if (alive) setToolWhitelistCheck({ key: whitelistKey, value: false });
			},
		);
		return () => {
			alive = false;
		};
	}, [whitelistKey, isWhitelisted]);

	const items = useMemo(
		() =>
			permission
				? toolRequestItems({
						toolReq: activeToolReq,
						permission,
						isToolWhitelisted,
					})
				: [],
		[activeToolReq, permission, isToolWhitelisted],
	);
	const onSelect = useCallback(
		async (item: ToolRequestSelectItem) => {
			if (selectedToolCallIdRef.current === activeToolReq.toolCallId) return;
			selectedToolCallIdRef.current = activeToolReq.toolCallId;
			if (item.value === "no") {
				rejectTool(activeToolReq);
			} else if (item.value === "yes-whitelist") {
				const selectedWhitelistKey = whitelistKey;
				if (selectedWhitelistKey == null) {
					selectedToolCallIdRef.current = null;
					return;
				}
				await addToWhitelist(selectedWhitelistKey);
				await runTool({
					toolReq: activeToolReq,
					config,
					transport,
					skillDiscover,
					toolDefinitions,
					toolRun,
				});
				onDone();
			} else {
				await runTool({
					toolReq: activeToolReq,
					config,
					transport,
					skillDiscover,
					toolDefinitions,
					toolRun,
				});
				onDone();
			}
		},
		[
			activeToolReq,
			config,
			transport,
			addToWhitelist,
			runTool,
			rejectTool,
			whitelistKey,
			skillDiscover,
			toolDefinitions,
			toolRun,
			onDone,
		],
	);
	const isRunningSelector = useMemo(
		() => (state: UiState) =>
			selectIsRunningToolCall(state, activeToolReq.toolCallId),
		[activeToolReq.toolCallId],
	);
	const isRunning = useAppStore(isRunningSelector);

	const noConfirmationNeeded =
		permission != null &&
		(unchained || permission.skipConfirmation || isToolWhitelisted === true);

	useEffect(() => {
		autoRunToolCallIdRef.current = null;
		selectedToolCallIdRef.current = null;
	}, [activeToolReq.toolCallId]);

	useEffect(() => {
		if (noConfirmationNeeded) {
			if (autoRunToolCallIdRef.current === activeToolReq.toolCallId) return;
			autoRunToolCallIdRef.current = activeToolReq.toolCallId;
			runTool({
				toolReq: activeToolReq,
				config,
				transport,
				skillDiscover,
				toolDefinitions,
				toolRun,
			}).then(onDone);
		} else if (permission != null) {
			notifyReadyForInput(config);
		}
	}, [
		activeToolReq,
		noConfirmationNeeded,
		config,
		transport,
		onDone,
		skillDiscover,
		toolDefinitions,
		toolRun,
		runTool,
		notifyReadyForInput,
		permission,
	]);

	if (!toolPermission) {
		return <Text color="red">Tool permission bridge is required</Text>;
	}

	if (requestError != null) {
		return <Text color="red">{normalizeRenderedLineBreaks(requestError)}</Text>;
	}

	if (permission == null || noConfirmationNeeded || isRunning) {
		return <Loading overrideStrings={TOOL_REQUEST_LOADING_STRINGS} />;
	}

	return (
		<Box flexDirection="column" gap={1}>
			<ToolRequestPrompt toolReq={activeToolReq} configColor={themeColor} />
			<SelectInput
				items={items}
				onSelect={onSelect}
				indicatorComponent={IndicatorComponent}
				itemComponent={ToolRequestItem}
			/>
		</Box>
	);
}
