import type { ImageInfo } from "../../input/image_attachments.ts";

export type ImageModalityConfig = {
	enabled: boolean;
	maxSizeMB: number;
	acceptedMimeTypes: string[];
};

export type MultimodalConfig = {
	image?: ImageModalityConfig;
};

export type CanDisplayImageResult =
	| { ok: true }
	| { ok: false; reason: string };

export type ToolCallLike = {
	toolCallId: string;
};

export type TextContentPart = {
	type: "text";
	content: string;
};

export type ImageContentPart = {
	type: "image";
	image: ImageInfo;
};

export type FileReadIR<TToolCall extends ToolCallLike> = {
	role: "file-read";
	content: string;
	toolCall: TToolCall;
	path: string;
	image?: ImageInfo;
};

export type FileMutateIR<TToolCall extends ToolCallLike> = {
	role: "file-mutate";
	content: string;
	toolCall: TToolCall;
	path: string;
};

export type UserMessageWithImage = {
	role: "user";
	content: Array<TextContentPart | ImageContentPart>;
};

export type ToolOutputMessage<TToolCall extends ToolCallLike> = {
	role: "tool-output";
	toolCall: TToolCall;
	content: TextContentPart[];
};

export type FileOptimizerInputIR<TBaseMessage, TToolCall extends ToolCallLike> =
	| TBaseMessage
	| FileReadIR<TToolCall>
	| FileMutateIR<TToolCall>;

export type OptimizedFileIR<TBaseMessage, TToolCall extends ToolCallLike> =
	| TBaseMessage
	| UserMessageWithImage
	| ToolOutputMessage<TToolCall>;

export function optimizeFiles<TBaseMessage, TToolCall extends ToolCallLike>(
	messages: FileOptimizerInputIR<TBaseMessage, TToolCall>[],
	modalities?: MultimodalConfig,
): OptimizedFileIR<TBaseMessage, TToolCall>[] {
	const output: OptimizedFileIR<TBaseMessage, TToolCall>[] = [];
	const seenPaths = new Set<string>();

	for (const ir of [...messages].reverse()) {
		output.push(optimizeFileIR(ir, seenPaths, modalities));
	}

	return output.reverse();
}

export function canDisplayImage(
	modalities: MultimodalConfig | undefined,
	image: ImageInfo,
): CanDisplayImageResult {
	if (!modalities?.image?.enabled) {
		return { ok: false, reason: "Your model does not support image viewing." };
	}
	if (!modalities.image.acceptedMimeTypes.includes(image.mimeType)) {
		return {
			ok: false,
			reason: `Your model does not support ${image.mimeType} images. Supported formats: ${modalities.image.acceptedMimeTypes.join(", ")}.`,
		};
	}
	if (
		image.sizeBytes != null &&
		image.sizeBytes > modalities.image.maxSizeMB * 1024 * 1024
	) {
		const sizeMB = (image.sizeBytes / (1024 * 1024)).toFixed(1);
		return {
			ok: false,
			reason: `Image file is too large (${sizeMB} MB). Maximum supported size is ${modalities.image.maxSizeMB} MB.`,
		};
	}
	return { ok: true };
}

function optimizeFileIR<TBaseMessage, TToolCall extends ToolCallLike>(
	ir: FileOptimizerInputIR<TBaseMessage, TToolCall>,
	seenPaths: Set<string>,
	modalities?: MultimodalConfig,
): OptimizedFileIR<TBaseMessage, TToolCall> {
	if (isFileReadIR<TToolCall>(ir)) {
		const seenPath = seenPaths.has(ir.path);
		seenPaths.add(ir.path);

		const imageCheck = ir.image ? canDisplayImage(modalities, ir.image) : null;
		if (ir.image && imageCheck?.ok) {
			return {
				role: "user",
				content: [
					{
						type: "text",
						content: `[Tool result for call ${ir.toolCall.toolCallId}]: ${ir.content}`,
					},
					{ type: "image", image: ir.image },
				],
			};
		}

		return {
			role: "tool-output",
			toolCall: ir.toolCall,
			content: [
				{
					type: "text",
					content: fileReadMessage(ir.content, seenPath, imageCheck),
				},
			],
		};
	}

	if (isFileMutateIR<TToolCall>(ir)) {
		return {
			role: "tool-output",
			toolCall: ir.toolCall,
			content: [{ type: "text", content: fileMutationMessage(ir.path) }],
		};
	}

	return ir;
}

function isFileReadIR<TToolCall extends ToolCallLike>(
	value: unknown,
): value is FileReadIR<TToolCall> {
	return isRole(value, "file-read");
}

function isFileMutateIR<TToolCall extends ToolCallLike>(
	value: unknown,
): value is FileMutateIR<TToolCall> {
	return isRole(value, "file-mutate");
}

function isRole(value: unknown, role: string): value is { role: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"role" in value &&
		value.role === role
	);
}

function fileMutationMessage(filePath: string): string {
	return `${filePath} was updated successfully.`;
}

function fileReadMessage(
	content: string,
	seenPath: boolean,
	imageCheck?: CanDisplayImageResult | null,
): string {
	if (imageCheck && !imageCheck.ok) {
		return `${content}\n[An image file was read but could not be displayed: ${imageCheck.reason} The image content has been omitted.]`;
	}
	if (seenPath) return "File was successfully read.";
	return content;
}
