import { Box, Text } from "ink";
import type { OctoIR } from "../runtime/agent/ir/main.ts";
import type { HistoryItem } from "../runtime/history/main.ts";
import { useModel } from "../shell/state/model-hook.ts";
import {
	TerminalHeader,
	useTerminalThemeColor,
	useTerminalUnchained,
} from "../theme/branding.tsx";
import { normalizeRenderedLineBreaks } from "./lines.ts";
import { Markdown } from "./markdown.tsx";
import { MessageDisplay } from "./messages.tsx";
import type { StaticItem } from "./types.ts";

export function toStaticItems(messages: HistoryItem<OctoIR>[]): StaticItem[] {
	const items: StaticItem[] = [];
	appendHistoryStaticItems(items, messages);
	return items;
}

export function appendHistoryStaticItems(
	items: StaticItem[],
	messages: HistoryItem<OctoIR>[],
): void {
	let index = 0;
	let writeIndex = items.length;
	while (index < messages.length) {
		const message = messages[index];
		if (message !== undefined) {
			items[writeIndex] = { type: "history-item", item: message };
			writeIndex += 1;
		}
		index += 1;
	}
}

export function staticItemKey(item: StaticItem, index: number): string {
	if (item.type === "header") return "header";
	if (item.type === "version") return "version";
	if (item.type === "updates") return "updates";
	if (item.type === "slogan") return "slogan";
	if (item.type === "boot-notification") {
		return `boot-notification:${index}:${item.content}`;
	}
	return historyStaticItemKey(item.item, index);
}

function historyStaticItemKey(
	item: HistoryItem<OctoIR>,
	index: number,
): string {
	if (item.type === "notification")
		return `notification:${index}:${item.content}`;
	if (item.type !== "llm-ir") return `${item.type}:${index}`;
	return irStaticItemKey(item.ir, index);
}

function irStaticItemKey(ir: OctoIR, index: number): string {
	if ("messageId" in ir && typeof ir.messageId === "string") {
		return `message:${ir.messageId}`;
	}
	if ("toolCall" in ir && typeof ir.toolCall.toolCallId === "string") {
		return `tool:${ir.role}:${ir.toolCall.toolCallId}`;
	}
	if (
		"malformedRequest" in ir &&
		typeof ir.malformedRequest.toolCallId === "string"
	) {
		return `tool-parse-error:${ir.malformedRequest.toolCallId}`;
	}
	return `ir:${ir.role}:${index}`;
}

export const StaticItemRenderer = ({ item }: { item: StaticItem }) => {
	if (item.type === "header") return <HeaderStaticItem />;
	if (item.type === "version")
		return <VersionStaticItem version={item.metadata.version} />;
	if (item.type === "slogan") return <SloganStaticItem />;
	if (item.type === "updates")
		return <UpdatesStaticItem updates={item.updates} />;
	if (item.type === "boot-notification") {
		return <BootNotificationStaticItem content={item.content} />;
	}

	return <MessageDisplay item={item.item} />;
};

function HeaderStaticItem() {
	const unchained = useTerminalUnchained();
	return <TerminalHeader unchained={unchained} />;
}

function VersionStaticItem({ version }: { version: string }) {
	const model = useModel();
	return (
		<Box marginTop={1} marginLeft={1} flexDirection="column">
			<Text color="gray">Model: {model.nickname}</Text>
			<Text color="gray">Version: {version}</Text>
		</Box>
	);
}

function SloganStaticItem() {
	const themeColor = useTerminalThemeColor();
	return (
		<Box marginLeft={1} marginTop={1}>
			<Text>
				Octo is your friend. Tell Octo{" "}
				<Text color={themeColor}>what you want to do.</Text>
			</Text>
		</Box>
	);
}

function UpdatesStaticItem({ updates }: { updates: string }) {
	return (
		<Box marginTop={1} marginLeft={1} flexDirection="column">
			<Text bold={true}>Updates:</Text>
			<Box marginTop={1} marginLeft={1}>
				<Markdown markdown={updates} />
			</Box>
			<Text color="gray">Thanks for updating!</Text>
			<Text color="gray">
				See the full changelog by running: `octo changelog`
			</Text>
		</Box>
	);
}

function BootNotificationStaticItem({ content }: { content: string }) {
	return (
		<Box marginLeft={1}>
			<Text color="gray">{normalizeRenderedLineBreaks(content)}</Text>
		</Box>
	);
}
