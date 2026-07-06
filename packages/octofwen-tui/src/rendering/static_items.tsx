import { Box, Text } from "ink";
import { useModel } from "../app/state/model-hook.ts";
import type { HistoryItem } from "../internal/conversation-history/main.ts";
import type { OctoIR } from "../internal/octo-agent-ir/main.ts";
import {
	TerminalHeader,
	useTerminalThemeColor,
	useTerminalUnchained,
} from "../theme/branding.tsx";
import { Markdown } from "./markdown.tsx";
import { MessageDisplay } from "./messages.tsx";
import type { StaticItem } from "./types.ts";

export function toStaticItems(messages: HistoryItem<OctoIR>[]): StaticItem[] {
	return messages.map((message) => ({
		type: "history-item",
		item: message,
	}));
}

export const StaticItemRenderer = ({ item }: { item: StaticItem }) => {
	const themeColor = useTerminalThemeColor();
	const model = useModel();
	const unchained = useTerminalUnchained();

	if (item.type === "header") return <TerminalHeader unchained={unchained} />;
	if (item.type === "version") {
		return (
			<Box marginTop={1} marginLeft={1} flexDirection="column">
				<Text color="gray">Model: {model.nickname}</Text>
				<Text color="gray">Version: {item.metadata.version}</Text>
			</Box>
		);
	}
	if (item.type === "slogan") {
		return (
			<Box marginLeft={1} marginTop={1}>
				<Text>
					Octo is your friend. Tell Octo{" "}
					<Text color={themeColor}>what you want to do.</Text>
				</Text>
			</Box>
		);
	}
	if (item.type === "updates") {
		return (
			<Box marginTop={1} marginLeft={1} flexDirection="column">
				<Text bold={true}>Updates:</Text>
				<Box marginTop={1} marginLeft={1}>
					<Markdown markdown={item.updates} />
				</Box>
				<Text color="gray">Thanks for updating!</Text>
				<Text color="gray">
					See the full changelog by running: `octo changelog`
				</Text>
			</Box>
		);
	}

	if (item.type === "boot-notification") {
		return (
			<Box marginLeft={1}>
				<Text color="gray">{item.content}</Text>
			</Box>
		);
	}

	return <MessageDisplay item={item.item} />;
};
