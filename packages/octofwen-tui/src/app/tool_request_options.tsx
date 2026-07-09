import { Box, Text } from "ink";
import type React from "react";
import type { ToolPermissionResult } from "../internal/tool-orchestration/bridge-types.ts";
import type { ToolCall as ToolCallRequest } from "../internal/tool-orchestration/main.ts";
import { normalizeRenderedLineBreaks } from "../rendering/line_splitting.ts";
import {
	parsedToolSchema,
	WhitelistAllowDescription,
} from "../rendering/tools.tsx";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import type { ToolRequestSelectItem } from "./tool_request_types.ts";

export const ToolRequestItem = ({
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

export function ToolRequestPrompt({
	toolReq,
	configColor,
}: {
	toolReq: ToolCallRequest;
	configColor: string;
}) {
	const fn = parsedToolSchema(toolReq);
	const filePath =
		typeof fn.arguments.filePath === "string"
			? normalizeRenderedLineBreaks(fn.arguments.filePath)
			: fn.arguments.filePath;
	switch (fn.name) {
		case "create":
			return (
				<Box>
					<Text>Create file </Text>
					<Text color={configColor}>{filePath}</Text>
					<Text>?</Text>
				</Box>
			);
		case "rewrite":
		case "edit":
			return (
				<Box>
					<Text>Make these changes to </Text>
					<Text color={configColor}>{filePath}</Text>
					<Text>?</Text>
				</Box>
			);
		default:
			return null;
	}
}

export function toolRequestItems({
	toolReq,
	permission,
	isToolWhitelisted,
}: {
	toolReq: ToolCallRequest;
	permission: ToolPermissionResult;
	isToolWhitelisted: boolean | null;
}): ToolRequestSelectItem[] {
	const items: ToolRequestSelectItem[] = [
		{
			label: "Yes",
			value: "yes",
		},
	];
	if (
		!(
			permission.skipConfirmation ||
			permission.alwaysRequestPermission ||
			isToolWhitelisted
		)
	) {
		items[items.length] = {
			label: "Yes, and always allow",
			value: "yes-whitelist",
			whitelistAllowDescription: (
				<WhitelistAllowDescription toolCallRequest={toolReq} />
			),
		};
	}
	items[items.length] = {
		label: "No, and tell Octo what to do differently",
		value: "no",
	};
	return items;
}
