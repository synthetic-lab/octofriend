import { Box, Text } from "ink";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ToolPermissionResult } from "../internal/tool-orchestration/bridge-types.ts";
import type { ToolCall as ToolCallRequest } from "../internal/tool-orchestration/main.ts";
import {
	ThemedSelectIndicator as IndicatorComponent,
	SelectInput,
} from "../menu/select.tsx";
import {
	parsedToolSchema,
	ToolMessageRenderer,
	WhitelistAllowDescription,
} from "../rendering/tools.tsx";
import {
	useTerminalThemeColor,
	useTerminalUnchained,
} from "../theme/branding.tsx";
import { Loading } from "./loading.tsx";
import { useAppStore } from "./state/store.ts";
import type { RunArgs } from "./state/types.ts";

export type TerminalToolRequestsProps = {
	toolReqs: ToolCallRequest[];
} & RunArgs;

export type TerminalToolRequestProps = {
	toolReq: ToolCallRequest;
	onDone: () => void;
} & RunArgs;

export type FinishToolRequestsProps = {
	runAgent: (args: RunArgs) => Promise<void>;
} & RunArgs;

export type ToolRequestSelectItem = {
	label: string;
	value: "yes" | "yes-whitelist" | "no";
	whitelistAllowDescription?: React.ReactNode;
};

const TOOL_REQUEST_LOADING_STRINGS = [
	"Waiting",
	"Watching",
	"Smiling",
	"Hungering",
	"Splashing",
	"Writhing",
];

const ToolRequestItem = ({
	isSelected = false,
	label,
	whitelistAllowDescription,
}: {
	isSelected?: boolean;
	label: string;
	whitelistAllowDescription?: React.ReactNode;
}) => {
	const themeColor = useTerminalThemeColor();

	return (
		<Text color={isSelected ? themeColor : undefined}>
			{label}
			{whitelistAllowDescription}
		</Text>
	);
};

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
	const runAgent = useAppStore((state) => state.runAgent);
	const [currentIndex, setCurrentIndex] = useState(0);
	const onDone = useCallback(() => {
		setCurrentIndex((i) => i + 1);
	}, []);

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

	const currentToolReq = toolReqs[currentIndex];

	return (
		<Box flexDirection="column">
			<ToolMessageRenderer item={currentToolReq} />
			<ToolRequestRenderer
				toolReq={currentToolReq}
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
	trajectoryArcRun,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
}: FinishToolRequestsProps) {
	useEffect(() => {
		runAgent({
			config,
			transport,
			trajectoryArcRun,
			toolPermission,
			skillDiscover,
			toolDefinitions,
			toolRun,
		});
	}, [
		runAgent,
		config,
		transport,
		trajectoryArcRun,
		toolPermission,
		skillDiscover,
		toolDefinitions,
		toolRun,
	]);
	return <Loading />;
}

function ToolRequestPrompt({
	toolReq,
	configColor,
}: {
	toolReq: ToolCallRequest;
	configColor: string;
}) {
	const fn = parsedToolSchema(toolReq);
	switch (fn.name) {
		case "create":
			return (
				<Box>
					<Text>Create file </Text>
					<Text color={configColor}>{fn.arguments.filePath}</Text>
					<Text>?</Text>
				</Box>
			);
		case "rewrite":
		case "edit":
			return (
				<Box>
					<Text>Make these changes to </Text>
					<Text color={configColor}>{fn.arguments.filePath}</Text>
					<Text>?</Text>
				</Box>
			);
		default:
			return null;
	}
}

function toolRequestItems({
	toolReq,
	permission,
	isToolWhitelisted,
}: {
	toolReq: ToolCallRequest;
	permission: ToolPermissionResult;
	isToolWhitelisted: boolean | null;
}): ToolRequestSelectItem[] {
	return [
		{
			label: "Yes",
			value: "yes",
		},
		...(permission.skipConfirmation ||
		permission.alwaysRequestPermission ||
		isToolWhitelisted
			? []
			: [
					{
						label: "Yes, and always allow",
						value: "yes-whitelist" as const,
						whitelistAllowDescription: (
							<WhitelistAllowDescription toolCallRequest={toolReq} />
						),
					},
				]),
		{
			label: "No, and tell Octo what to do differently",
			value: "no",
		},
	];
}

export function ToolRequestRenderer({
	toolReq,
	config,
	transport,
	trajectoryArcRun,
	toolPermission,
	skillDiscover,
	toolDefinitions,
	toolRun,
	onDone,
}: TerminalToolRequestProps) {
	const themeColor = useTerminalThemeColor();
	const {
		runTool,
		rejectTool,
		isWhitelisted,
		addToWhitelist,
		notifyReadyForInput,
	} = useAppStore(
		useShallow((state) => ({
			runTool: state.runTool,
			rejectTool: state.rejectTool,
			isWhitelisted: state.isWhitelisted,
			addToWhitelist: state.addToWhitelist,
			notifyReadyForInput: state.notifyReadyForInput,
		})),
	);
	const unchained = useTerminalUnchained();
	const [permission, setPermission] = useState<ToolPermissionResult | null>(
		null,
	);
	const whitelistKey = permission?.whitelistKey ?? null;
	const [isToolWhitelisted, setIsToolWhitelisted] = useState<boolean | null>(
		null,
	);

	if (!toolPermission) throw new Error("Tool permission bridge is required");

	useEffect(() => {
		let alive = true;
		(async () => {
			const resolved = await toolPermission({
				toolName: toolReq.name,
				parsed: toolReq.parsed,
			});
			if (alive) setPermission(resolved);
		})();
		return () => {
			alive = false;
		};
	}, [toolPermission, toolReq]);

	useEffect(() => {
		if (whitelistKey == null) return;
		(async () => {
			const whitelisted = await isWhitelisted(whitelistKey);
			setIsToolWhitelisted(whitelisted);
		})();
	}, [whitelistKey, isWhitelisted]);

	const items = permission
		? toolRequestItems({ toolReq, permission, isToolWhitelisted })
		: [];
	const onSelect = useCallback(
		async (item: ToolRequestSelectItem) => {
			if (item.value === "no") {
				rejectTool(toolReq);
			} else if (item.value === "yes-whitelist") {
				if (whitelistKey == null) return;
				await addToWhitelist(whitelistKey);
				await runTool({
					toolReq,
					config,
					transport,
					skillDiscover,
					toolDefinitions,
					toolRun,
				});
				onDone();
			} else {
				await runTool({
					toolReq,
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
			toolReq,
			config,
			transport,
			addToWhitelist,
			runTool,
			rejectTool,
			whitelistKey,
			toolRun,
			onDone,
		],
	);
	const { modeData } = useAppStore(
		useShallow((state) => ({ modeData: state.modeData })),
	);
	const isRunning =
		modeData.mode === "tool-call" &&
		modeData.runningToolCallId === toolReq.toolCallId;

	const noConfirmationNeeded =
		permission != null &&
		(unchained || permission.skipConfirmation || isToolWhitelisted === true);

	useEffect(() => {
		if (noConfirmationNeeded) {
			runTool({
				toolReq,
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
		toolReq,
		noConfirmationNeeded,
		config,
		transport,
		onDone,
		trajectoryArcRun,
		toolPermission,
		permission,
	]);

	if (permission == null || noConfirmationNeeded || isRunning) {
		return <Loading overrideStrings={TOOL_REQUEST_LOADING_STRINGS} />;
	}

	return (
		<Box flexDirection="column" gap={1}>
			<ToolRequestPrompt toolReq={toolReq} configColor={themeColor} />
			<SelectInput
				items={items}
				onSelect={onSelect}
				indicatorComponent={IndicatorComponent}
				itemComponent={ToolRequestItem}
			/>
		</Box>
	);
}
