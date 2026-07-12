import { Box, Text } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestInput, useLatestRef } from "../../input/latest-input.ts";
import { TextInput } from "../../input/text.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { useTerminalContentWidth } from "../../layout/viewport.tsx";
import { writeKeyForModel } from "../../runtime/config/keys.ts";
import type { ProviderConfig } from "../../runtime/models/catalog/main.ts";
import { MenuHeader } from "../root.tsx";
import {
	getProviderApiKeyUrl,
	getProviderDisplayName,
	nonEmptyTrimmedValue,
	terminalHyperlink,
} from "./providers.ts";

export const EMPTY_API_KEY_ERROR = "API key can't be empty";
export const API_KEY_WRITE_ERROR =
	"Write to key file failed. Is your filesystem corrupt?";
export const API_KEY_COMPLETE_ERROR =
	"API key saved, but setup did not complete. Try again.";

export type ApiKeyValidationResult =
	| { valid: true }
	| { valid: false; error: string };

type WriteKeyForModel = typeof writeKeyForModel;

export type SetApiKeyProps = {
	nickname?: string;
	baseUrl: string;
	provider?: Pick<ProviderConfig, "apiKeyUrl" | "name">;
	onComplete: (apiKey: string) => void | Promise<void>;
	onCancel: () => void;
	writeKey?: WriteKeyForModel;
};

export function validateApiKeyValue(value: string): ApiKeyValidationResult {
	if (nonEmptyTrimmedValue(value) === null) {
		return { valid: false, error: EMPTY_API_KEY_ERROR };
	}
	return { valid: true };
}

export function SetApiKey({
	baseUrl,
	provider,
	onComplete,
	onCancel,
	writeKey = writeKeyForModel,
}: SetApiKeyProps) {
	const name = provider?.name ?? getProviderDisplayName(baseUrl);
	const apiKeyUrl = provider?.apiKeyUrl ?? getProviderApiKeyUrl(baseUrl);
	const showEndpoint = name !== baseUrl;
	const [saving, setSaving] = useState(false);
	const [varValue, setVarValue] = useState("");
	const [errorMessage, setErrorMessage] = useState<null | string>(null);
	const mountedRef = useRef(true);
	const savingRef = useRef(saving);
	const valueRef = useLatestRef(varValue);
	const baseUrlRef = useLatestRef(baseUrl);
	const onCompleteRef = useLatestRef(onComplete);
	const onCancelRef = useLatestRef(onCancel);
	const writeKeyRef = useLatestRef(writeKey);
	const width = useTerminalContentWidth();
	savingRef.current = saving;

	useEffect(() => {
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useLatestInput(
		useCallback((_, key) => {
			if (key.escape && !savingRef.current) onCancelRef.current();
		}, []),
	);

	const onValueChange = useCallback((value: string) => {
		valueRef.current = value;
		setErrorMessage(null);
		setVarValue(value);
	}, []);

	const onSubmit = useCallback(() => {
		if (savingRef.current) return;

		const apiKey = nonEmptyTrimmedValue(valueRef.current);
		if (apiKey === null) {
			setErrorMessage(EMPTY_API_KEY_ERROR);
			return;
		}

		savingRef.current = true;
		setSaving(true);
		Promise.resolve()
			.then(() => writeKeyRef.current({ baseUrl: baseUrlRef.current }, apiKey))
			.then(
				() => Promise.resolve().then(() => onCompleteRef.current(apiKey)),
				() => Promise.reject(API_KEY_WRITE_ERROR),
			)
			.catch((error) => {
				if (!mountedRef.current) return;
				savingRef.current = false;
				setSaving(false);
				setErrorMessage(
					error === API_KEY_WRITE_ERROR
						? API_KEY_WRITE_ERROR
						: API_KEY_COMPLETE_ERROR,
				);
			});
	}, []);

	if (saving) {
		return (
			<CenteredBox>
				<MenuHeader title="Saving..." />
			</CenteredBox>
		);
	}

	return (
		<CenteredBox>
			<MenuHeader title="Set the API key" />

			<Text>
				Enter your API key for {name}
				{name === baseUrl ? "." : ""}
			</Text>
			{showEndpoint && <Text color="gray">Endpoint: {baseUrl}</Text>}
			{apiKeyUrl && <Text>Get one at {terminalHyperlink(apiKeyUrl)}</Text>}

			<Box marginY={1} width={width}>
				<Box marginRight={1}>
					<Text>API key:</Text>
				</Box>

				<TextInput
					value={varValue}
					mask="•"
					onChange={onValueChange}
					onSubmit={onSubmit}
				/>
			</Box>
			{errorMessage && (
				<Box width={width}>
					<Text color="red" bold={true}>
						{errorMessage}
					</Text>
				</Box>
			)}
		</CenteredBox>
	);
}
