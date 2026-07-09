import { Box, Text } from "ink";
import type React from "react";
import type { Content } from "../internal/llm-ir/main.ts";
import type { OctoIR } from "../internal/octo-agent-ir/main.ts";
import { appendContentTextLines } from "./content.tsx";

type UserItem = Extract<OctoIR, { role: "user" }>;

export function renderUserItem(item: UserItem) {
	const { imageCount, textRows } = renderUserContent(item.content);

	return (
		<Box flexDirection="column" marginY={1}>
			<Box flexDirection="row">
				<Box marginRight={1}>
					<Text color="white">▶</Text>
				</Box>
				{imageCount > 0 && (
					<Box marginRight={1}>
						<Text inverse={true}>
							⟦ 📎 {imageCount} image{imageCount > 1 ? "s" : ""} attached ⟧
						</Text>
					</Box>
				)}
				<Box flexDirection="column">{textRows}</Box>
			</Box>
		</Box>
	);
}

function renderUserContent(content: readonly Content["content"][number][]): {
	imageCount: number;
	textRows: React.ReactNode[];
} {
	const rows: React.ReactNode[] = [];
	let imageCount = 0;
	let writeIndex = 0;
	let textPartIndex = 0;
	let partIndex = 0;
	while (partIndex < content.length) {
		const part = content[partIndex];
		partIndex += 1;
		if (part === undefined) continue;
		if (part.type !== "text") {
			imageCount += 1;
			continue;
		}
		writeIndex = appendContentTextLines(
			rows,
			writeIndex,
			part.content,
			textPartIndex,
			undefined,
			true,
		);
		textPartIndex += 1;
	}
	return { imageCount, textRows: rows };
}
