import { Box, Text } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatestInput, useLatestRef } from "../../input/latest-input.ts";
import { TextInput } from "../../input/text.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { normalizeRenderedLineBreaks } from "../../render/lines.ts";
import type { Config } from "../../runtime/config/schemas.ts";
import { providerEntries } from "../../runtime/models/catalog/main.ts";
import { useTerminalThemeColor } from "../../theme/branding.tsx";
import { errorToString } from "../result.ts";
import { nonEmptyTrimmedText } from "../text-processing.ts";
import {
	type WriteFirstTimeConfigInput,
	writeFirstTimeConfig,
} from "./config-writer.ts";
import type { AutofixConfig } from "./types.ts";

type WriteFirstTimeConfig = (input: WriteFirstTimeConfigInput) => Promise<void>;

type SetupSummary = {
	readonly modelCount: number;
	readonly modelNames: string;
	readonly hasAutofix: boolean;
	readonly modelAuth: string;
	readonly modelAuthFallback: string;
	readonly apiKeyOverrides: string;
};

const DEFAULT_PROVIDER_ENTRIES = providerEntries();
const DEFAULT_PROVIDER_KEYS: ReadonlySet<string> = defaultProviderKeys();

function defaultProviderKeys(): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const [providerKey] of DEFAULT_PROVIDER_ENTRIES) {
		keys.add(providerKey);
	}
	return keys;
}

function appendApiKeyOverride(
	parts: string[],
	providerName: string,
	envVar: string | undefined,
): void {
	if (envVar === undefined) return;
	const trimmedEnvVar = nonEmptyTrimmedText(envVar);
	if (trimmedEnvVar !== null) {
		parts[parts.length] = `${providerName}: ${trimmedEnvVar}`;
	}
}

function ownOverrideValue(
	overrides: Record<string, string>,
	providerKey: string,
): string | undefined {
	return Object.hasOwn(overrides, providerKey)
		? overrides[providerKey]
		: undefined;
}

function formatApiKeyOverrides(overrides: Record<string, string>): string {
	const parts: string[] = [];
	for (const [providerKey, provider] of DEFAULT_PROVIDER_ENTRIES) {
		appendApiKeyOverride(
			parts,
			provider.name,
			ownOverrideValue(overrides, providerKey),
		);
	}
	for (const providerKey in overrides) {
		if (!Object.hasOwn(overrides, providerKey)) continue;
		if (DEFAULT_PROVIDER_KEYS.has(providerKey)) continue;
		appendApiKeyOverride(parts, providerKey, overrides[providerKey]);
	}
	return parts.join(", ");
}

function joinModelNames(models: Config["models"]): string {
	if (models.length === 0) return "";
	const names = new Array<string>(models.length);
	for (let index = 0; index < models.length; index += 1) {
		names[index] = models[index]?.nickname ?? "";
	}
	return names.join(", ");
}

function setupSummary({
	models,
	autofixConfig,
	defaultApiKeyOverrides,
}: Pick<
	NameStepProps,
	"models" | "autofixConfig" | "defaultApiKeyOverrides"
>): SetupSummary {
	return {
		modelCount: models.length,
		modelNames: joinModelNames(models),
		modelAuth: formatModelAuth(models),
		modelAuthFallback: models.length === 0 ? "none" : "stored keys",
		hasAutofix: autofixConfig != null,
		apiKeyOverrides: formatApiKeyOverrides(defaultApiKeyOverrides),
	};
}

function formatModelAuth(models: Config["models"]): string {
	const parts: string[] = [];
	for (const model of models) {
		const entry = formatSingleModelAuth(model);
		if (entry !== null) parts[parts.length] = entry;
	}
	return parts.join(", ");
}

function formatSingleModelAuth(model: Config["models"][number]): string | null {
	const auth = model.auth;
	if (auth?.type === "env") {
		const envVar = trimmedAuthEnvName(auth.name);
		if (envVar === null) return null;
		const label =
			auth.credential === "chatgpt-oauth" ? "ChatGPT OAuth" : "API key";
		return `${model.nickname}: ${envVar} (${label})`;
	}
	if (auth?.type === "command") return `${model.nickname}: command`;
	if (!model.apiEnvVar) return null;
	const envVar = trimmedAuthEnvName(model.apiEnvVar);
	return envVar === null ? null : `${model.nickname}: ${envVar} (API key)`;
}

function trimmedAuthEnvName(name: string): string | null {
	const trimmed = name.trim();
	return trimmed.length === 0 ? null : trimmed;
}

export type NameStepProps = {
	configPath: string;
	models: Config["models"];
	autofixConfig?: AutofixConfig;
	defaultApiKeyOverrides: Record<string, string>;
	onDone: () => void;
	onBack?: () => void;
	writeConfig?: WriteFirstTimeConfig;
};

export function NameStep({
	configPath,
	models,
	autofixConfig,
	defaultApiKeyOverrides,
	onDone,
	onBack,
	writeConfig = writeFirstTimeConfig,
}: NameStepProps) {
	const [yourName, setYourName] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const mountedRef = useRef(true);
	const savingRef = useRef(saving);
	const yourNameRef = useLatestRef(yourName);
	const configPathRef = useLatestRef(configPath);
	const modelsRef = useLatestRef(models);
	const autofixConfigRef = useLatestRef(autofixConfig);
	const defaultApiKeyOverridesRef = useLatestRef(defaultApiKeyOverrides);
	const onDoneRef = useLatestRef(onDone);
	const onBackRef = useLatestRef(onBack);
	const writeConfigRef = useLatestRef(writeConfig);
	const themeColor = useTerminalThemeColor();
	savingRef.current = saving;
	const summary = useMemo(
		() =>
			setupSummary({
				models,
				autofixConfig,
				defaultApiKeyOverrides,
			}),
		[autofixConfig, defaultApiKeyOverrides, models],
	);

	useEffect(() => {
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useLatestInput(
		useCallback((_, key) => {
			if (key.escape && !savingRef.current) onBackRef.current?.();
		}, []),
	);

	const onValueChange = useCallback((value: string) => {
		yourNameRef.current = value;
		setYourName(value);
		setNameError(null);
	}, []);

	const onSubmit = useCallback(() => {
		if (savingRef.current) return;
		const trimmedName = nonEmptyTrimmedText(yourNameRef.current);
		if (trimmedName === null) {
			setNameError("Name can't be empty");
			return;
		}

		setNameError(null);
		savingRef.current = true;
		setSaving(true);
		Promise.resolve()
			.then(() =>
				writeConfigRef.current({
					configPath: configPathRef.current,
					yourName: trimmedName,
					models: modelsRef.current,
					defaultApiKeyOverrides: defaultApiKeyOverridesRef.current,
					autofixConfig: autofixConfigRef.current,
				}),
			)
			.then(
				() => {
					if (!mountedRef.current) return;
					onDoneRef.current();
				},
				(error) => {
					if (!mountedRef.current) return;
					savingRef.current = false;
					setSaving(false);
					setNameError(`Failed to save config: ${errorToString(error)}`);
				},
			);
	}, []);

	return (
		<CenteredBox>
			<Text color={themeColor}>
				Review setup, then enter your name to save.
			</Text>

			<Box marginTop={1} flexDirection="column">
				<Text>
					Main models: {summary.modelCount}
					{summary.modelNames
						? ` (${normalizeRenderedLineBreaks(summary.modelNames)})`
						: ""}
				</Text>
				<Text>
					Autofix models: {summary.hasAutofix ? "enabled" : "not enabled"}
				</Text>
				<Text>
					Model auth:{" "}
					{normalizeRenderedLineBreaks(
						summary.modelAuth || summary.modelAuthFallback,
					)}
				</Text>
				<Text>
					API-key overrides:{" "}
					{normalizeRenderedLineBreaks(summary.apiKeyOverrides || "none")}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Box marginRight={1}>
					<Text>Your name:</Text>
				</Box>
				<TextInput
					value={yourName}
					focus={!saving}
					onChange={onValueChange}
					onSubmit={onSubmit}
				/>
			</Box>

			{saving && (
				<Box marginTop={1}>
					<Text color="gray">Saving config...</Text>
				</Box>
			)}

			{nameError && (
				<Box marginTop={1}>
					<Text color="red">{normalizeRenderedLineBreaks(nameError)}</Text>
				</Box>
			)}
		</CenteredBox>
	);
}
