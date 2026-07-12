import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import clipboardy from "clipboardy";
import { Box, Text, useApp } from "ink";
import {
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useLatestInput } from "../input/latest-input.ts";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../input/shortcuts.tsx";
import { CenteredBox } from "../layout/boxes.tsx";
import { normalizeRenderedLineBreaks } from "../render/lines.ts";
import { useConfig } from "../runtime/config/react-context.ts";
import { errorToString } from "./result.ts";
import { useAppStore } from "./state/store.ts";
import type { UiState } from "./state/types.ts";
import { TransportContext } from "./transport-context.tsx";

export type RequestErrorMode = "request-error" | "compaction-error";

export type RequestErrorScreenProps = {
	mode: RequestErrorMode;
	contextualMessage: string;
	error: string;
	curlCommand: string | null;
	clipboardWriteSync?: (text: string) => void;
	writeCurlFile?: (command: string) => Promise<string>;
};

export type AuthErrorScreenProps = {
	error: string;
};

export type RateLimitErrorScreenProps = {
	error: string;
};

export type PaymentErrorScreenProps = {
	error: string;
};

type RequestErrorAction =
	| "view"
	| "copy-curl"
	| "write-curl"
	| "retry"
	| "edit-retry"
	| "quit";

type RetryOnInputErrorMode =
	| "auth-error"
	| "rate-limit-error"
	| "payment-error";

type RetryOnInputErrorScreenProps = {
	mode: RetryOnInputErrorMode;
	error: string;
	children: ReactNode;
};

const VIEW_ERROR_ITEM: Item<RequestErrorAction> = {
	label: "View error",
	value: "view",
};
const COPY_CURL_ITEM: Item<RequestErrorAction> = {
	label: "Copy failed request as cURL",
	value: "copy-curl",
};
const COPIED_CURL_ITEM: Item<RequestErrorAction> = {
	label: "Copied cURL!",
	value: "copy-curl",
};
const WRITE_CURL_ITEM: Item<RequestErrorAction> = {
	label: "Write failed request as a cURL script",
	value: "write-curl",
};
const WROTE_CURL_ITEM: Item<RequestErrorAction> = {
	label: "Wrote cURL script!",
	value: "write-curl",
};

const RETRY_ITEM: Item<RequestErrorAction> = {
	label: "Retry",
	value: "retry",
};
const EDIT_RETRY_ITEM: Item<RequestErrorAction> = {
	label: "Edit & retry",
	value: "edit-retry",
};
const QUIT_ITEM: Item<RequestErrorAction> = {
	label: "Quit Octo",
	value: "quit",
};

const requestRetryActionsSelector = (state: UiState) => ({
	retryFrom: state.retryFrom,
	editAndRetryFrom: state.editAndRetryFrom,
});

const retryFromSelector = (state: UiState) => ({
	retryFrom: state.retryFrom,
});

function requestErrorShortcutItems({
	viewError,
	curlCommand,
	copiedCurl,
	wroteCurl,
}: {
	viewError: boolean;
	curlCommand: string | null;
	copiedCurl: boolean;
	wroteCurl: boolean;
}): ShortcutArray<RequestErrorAction> {
	const mapping: Record<string, Item<RequestErrorAction>> = {};
	if (!viewError) mapping.v = VIEW_ERROR_ITEM;
	if (curlCommand) {
		mapping.c = copiedCurl ? COPIED_CURL_ITEM : COPY_CURL_ITEM;
		mapping.w = wroteCurl ? WROTE_CURL_ITEM : WRITE_CURL_ITEM;
	}
	mapping.r = RETRY_ITEM;
	mapping.e = EDIT_RETRY_ITEM;
	mapping.q = QUIT_ITEM;
	return [
		{
			type: "key",
			mapping,
		},
	];
}

async function writeCurlCommandFile(command: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "octofriend-curl-"));
	const filePath = join(directory, "request.sh");
	const contents = command.endsWith("\n") ? command : command.concat("\n");
	await writeFile(filePath, contents, {
		encoding: "utf8",
		mode: 0o700,
	});
	return filePath;
}

export function RequestErrorScreen({
	mode,
	contextualMessage,
	error,
	curlCommand,
	clipboardWriteSync = clipboardy.writeSync,
	writeCurlFile = writeCurlCommandFile,
}: RequestErrorScreenProps) {
	const config = useConfig();
	const transport = useContext(TransportContext);
	const { retryFrom, editAndRetryFrom } = useAppStore(
		useShallow(requestRetryActionsSelector),
	);
	const { exit } = useApp();

	const [viewError, setViewError] = useState(false);
	const [copiedCurlCommand, setCopiedCurlCommand] = useState<string | null>(
		null,
	);
	const [clipboardError, setClipboardError] = useState<{
		command: string;
		message: string;
	} | null>(null);
	const [writtenCurl, setWrittenCurl] = useState<{
		command: string;
		filePath: string;
	} | null>(null);
	const [writeError, setWriteError] = useState<{
		command: string;
		message: string;
	} | null>(null);
	const copiedCurl = curlCommand !== null && copiedCurlCommand === curlCommand;
	const activeClipboardError =
		curlCommand !== null && clipboardError?.command === curlCommand
			? clipboardError.message
			: null;
	const activeWrittenCurl =
		curlCommand !== null && writtenCurl?.command === curlCommand
			? writtenCurl.filePath
			: null;
	const activeWriteError =
		curlCommand !== null && writeError?.command === curlCommand
			? writeError.message
			: null;

	const shortcutItems = useMemo(
		() =>
			requestErrorShortcutItems({
				viewError,
				curlCommand,
				copiedCurl,
				wroteCurl: activeWrittenCurl !== null,
			}),
		[activeWrittenCurl, copiedCurl, curlCommand, viewError],
	);

	const copyCurlCommand = useCallback(() => {
		if (!curlCommand) return;
		try {
			clipboardWriteSync(curlCommand);
			setClipboardError(null);
			setCopiedCurlCommand(curlCommand);
		} catch (error) {
			setCopiedCurlCommand(null);
			setClipboardError({
				command: curlCommand,
				message: errorToString(error) || "Failed to copy to clipboard",
			});
		}
	}, [clipboardWriteSync, curlCommand]);

	const writeCurlCommand = useCallback(async () => {
		if (!curlCommand) return;
		try {
			const filePath = await writeCurlFile(curlCommand);
			setWriteError(null);
			setWrittenCurl({ command: curlCommand, filePath });
		} catch (error) {
			setWrittenCurl(null);
			setWriteError({
				command: curlCommand,
				message: errorToString(error) || "Failed to write cURL script",
			});
		}
	}, [curlCommand, writeCurlFile]);

	const onSelect = useCallback(
		async (item: Item<RequestErrorAction>) => {
			switch (item.value) {
				case "view":
					setViewError(true);
					return;
				case "copy-curl":
					copyCurlCommand();
					return;
				case "write-curl":
					await writeCurlCommand();
					return;
				case "retry":
					retryFrom(mode, { config, transport });
					return;
				case "edit-retry":
					editAndRetryFrom(mode, { config, transport });
					return;
				case "quit":
					exit();
					return;
				default:
					return;
			}
		},
		[
			config,
			copyCurlCommand,
			editAndRetryFrom,
			exit,
			mode,
			retryFrom,
			transport,
			writeCurlCommand,
		],
	);

	return (
		<KbShortcutPanel title="" shortcutItems={shortcutItems} onSelect={onSelect}>
			<Text color="red">{normalizeRenderedLineBreaks(contextualMessage)}</Text>
			{viewError && (
				<Box marginY={1}>
					<Text>{normalizeRenderedLineBreaks(error)}</Text>
				</Box>
			)}
			{copiedCurl && (
				<Box marginY={1}>
					<Text color="green">cURL command copied to clipboard.</Text>
				</Box>
			)}
			{activeClipboardError && (
				<Box marginY={1}>
					<Text color="red">
						{normalizeRenderedLineBreaks(activeClipboardError)}
					</Text>
				</Box>
			)}
			{activeWrittenCurl && (
				<Box marginY={1}>
					<Text color="green">cURL script written to {activeWrittenCurl}</Text>
				</Box>
			)}
			{activeWriteError && (
				<Box marginY={1}>
					<Text color="red">
						{normalizeRenderedLineBreaks(activeWriteError)}
					</Text>
				</Box>
			)}
		</KbShortcutPanel>
	);
}

export function AuthErrorScreen({ error }: AuthErrorScreenProps) {
	return (
		<RetryOnInputErrorScreen mode="auth-error" error={error}>
			<Text color="red">Authentication error:</Text>
			<Text color="gray">
				Update your API key, then press any key to retry.
			</Text>
		</RetryOnInputErrorScreen>
	);
}

export function RateLimitErrorScreen({ error }: RateLimitErrorScreenProps) {
	return (
		<RetryOnInputErrorScreen mode="rate-limit-error" error={error}>
			<Text color="red">
				It looks like you've hit a rate limit! Here's the error from the
				backend:
			</Text>
			<Text color="gray">Press any key when you're ready to retry.</Text>
		</RetryOnInputErrorScreen>
	);
}

export function PaymentErrorScreen({ error }: PaymentErrorScreenProps) {
	return (
		<RetryOnInputErrorScreen mode="payment-error" error={error}>
			<Text color="red">Payment error:</Text>
			<Text color="gray">Once you've paid, press any key to continue.</Text>
		</RetryOnInputErrorScreen>
	);
}

function RetryOnInputErrorScreen({
	mode,
	error,
	children,
}: RetryOnInputErrorScreenProps) {
	const config = useConfig();
	const transport = useContext(TransportContext);
	const { retryFrom } = useAppStore(useShallow(retryFromSelector));

	const onInput = useCallback(() => {
		retryFrom(mode, { config, transport });
	}, [config, mode, retryFrom, transport]);

	useLatestInput(onInput);

	return (
		<CenteredBox>
			{children}
			<Text>{normalizeRenderedLineBreaks(error)}</Text>
		</CenteredBox>
	);
}
