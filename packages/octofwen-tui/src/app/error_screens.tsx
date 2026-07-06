import clipboardy from "clipboardy";
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useContext, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../input/shortcuts.tsx";
import { useConfig } from "../internal/configuration/react-context.ts";
import { CenteredBox } from "../layout/boxes.tsx";
import { useAppStore } from "./state/store.ts";
import { TransportContext } from "./transport_context.tsx";

export type RequestErrorMode = "request-error" | "compaction-error";

export type RequestErrorScreenProps = {
	mode: RequestErrorMode;
	contextualMessage: string;
	error: string;
	curlCommand: string | null;
};

export type RateLimitErrorScreenProps = {
	error: string;
};

export type PaymentErrorScreenProps = {
	error: string;
};

export function RequestErrorScreen({
	mode,
	contextualMessage,
	error,
	curlCommand,
}: RequestErrorScreenProps) {
	const config = useConfig();
	const transport = useContext(TransportContext);
	const { retryFrom, editAndRetryFrom } = useAppStore(
		useShallow((state) => ({
			retryFrom: state.retryFrom,
			editAndRetryFrom: state.editAndRetryFrom,
		})),
	);
	const { exit } = useApp();

	const [viewError, setViewError] = useState(false);
	const [copiedCurl, setCopiedCurl] = useState(false);
	const [clipboardError, setClipboardError] = useState<string | null>(null);

	const mapping: Record<
		string,
		Item<"view" | "copy-curl" | "retry" | "edit-retry" | "quit">
	> = {};

	if (!viewError) {
		mapping["v"] = {
			label: "View error",
			value: "view",
		};
	}

	if (curlCommand) {
		mapping["c"] = {
			label: copiedCurl ? "Copied cURL!" : "Copy failed request as cURL",
			value: "copy-curl",
		};
	}

	mapping["r"] = {
		label: "Retry",
		value: "retry",
	};

	mapping["e"] = {
		label: "Edit & retry",
		value: "edit-retry",
	};

	mapping["q"] = {
		label: "Quit Octo",
		value: "quit",
	};

	const shortcutItems: ShortcutArray<
		"view" | "copy-curl" | "retry" | "edit-retry" | "quit"
	> = [
		{
			type: "key" as const,
			mapping,
		},
	];

	const copyCurlCommand = useCallback(() => {
		try {
			clipboardy.writeSync(curlCommand || "Failed to generate cURL command");
			setCopiedCurl(true);
		} catch (error) {
			setClipboardError(
				error instanceof Error ? error.message : "Failed to copy to clipboard",
			);
		}
	}, [curlCommand]);

	const onSelect = useCallback(
		(item: Item<"view" | "copy-curl" | "retry" | "edit-retry" | "quit">) => {
			switch (item.value) {
				case "view":
					setViewError(true);
					return;
				case "copy-curl":
					copyCurlCommand();
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
		[copyCurlCommand, mode, config, transport],
	);

	return (
		<KbShortcutPanel title="" shortcutItems={shortcutItems} onSelect={onSelect}>
			<Text color="red">{contextualMessage}</Text>
			{viewError && (
				<Box marginY={1}>
					<Text>{error}</Text>
				</Box>
			)}
			{copiedCurl && (
				<Box marginY={1}>
					<Text>{curlCommand}</Text>
				</Box>
			)}
			{clipboardError && (
				<Box marginY={1}>
					<Text color="red">{clipboardError}</Text>
				</Box>
			)}
		</KbShortcutPanel>
	);
}

export function RateLimitErrorScreen({ error }: RateLimitErrorScreenProps) {
	const config = useConfig();
	const transport = useContext(TransportContext);
	const { retryFrom } = useAppStore(
		useShallow((state) => ({
			retryFrom: state.retryFrom,
		})),
	);

	useInput(() => {
		retryFrom("rate-limit-error", { config, transport });
	});

	return (
		<CenteredBox>
			<Text color="red">
				It looks like you've hit a rate limit! Here's the error from the
				backend:
			</Text>
			<Text>{error}</Text>
			<Text color="gray">Press any key when you're ready to retry.</Text>
		</CenteredBox>
	);
}

export function PaymentErrorScreen({ error }: PaymentErrorScreenProps) {
	const config = useConfig();
	const transport = useContext(TransportContext);
	const { retryFrom } = useAppStore(
		useShallow((state) => ({
			retryFrom: state.retryFrom,
		})),
	);

	useInput(() => {
		retryFrom("payment-error", { config, transport });
	});

	return (
		<CenteredBox>
			<Text color="red">Payment error:</Text>
			<Text>{error}</Text>
			<Text color="gray">Once you've paid, press any key to continue.</Text>
		</CenteredBox>
	);
}
