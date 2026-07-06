import { Box, Text } from "ink";
import { LINE_SPLIT_REGEX } from "../app/text_processing.ts";
import type { ImageInfo } from "../input/image_attachments.ts";
import type { Content } from "../internal/llm-ir/main.ts";

export type TerminalContent = Content["content"];

export function ToolOutputContentRenderer({
	content,
}: {
	content: TerminalContent;
}) {
	const textParts = content.filter((part) => part.type === "text");
	const imageParts = content.filter((part) => part.type === "image");
	const lines = textParts.reduce(
		(count, part) => count + part.content.split(LINE_SPLIT_REGEX).length,
		0,
	);

	return (
		<Box marginLeft={2} flexDirection="column">
			<Text color="gray">
				Got <Text>{lines}</Text> lines of output
			</Text>
			{imageParts.map((part, i) => (
				<ImageContentRenderer key={i} image={part.image} />
			))}
		</Box>
	);
}

export function ContentRenderer({
	content,
	textColor,
}: {
	content: TerminalContent;
	textColor?: string;
}) {
	return (
		<Box flexDirection="column">
			{content.map((part, i) => {
				if (part.type === "image") {
					return <ImageContentRenderer key={i} image={part.image} />;
				}

				return part.content.split(LINE_SPLIT_REGEX).map((line, lineIndex) => (
					<Text key={`${i}-${lineIndex}`} color={textColor}>
						{line}
					</Text>
				));
			})}
		</Box>
	);
}

export function ImageContentRenderer({ image }: { image: ImageInfo }) {
	return (
		<Text inverse={true}>
			⟦ 📎 {image.filePath} ({Math.ceil(image.sizeBytes / 1024)} KB) ⟧
		</Text>
	);
}
