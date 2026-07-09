import { Box, Text } from "ink";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { useLatestRef } from "../../input/latest-input";
import {
	keyFromName,
	type ProviderConfig,
	providerForBaseUrl,
	SYNTHETIC_PROVIDER,
} from "../../runtime/models/catalog/main";
import { useTerminalContentWidth } from "../../layout/viewport";
import { useTerminalThemeColor } from "../../theme/branding";
import {
	testConnection,
	useModelConnectionTest,
} from "./connection";
import { errorContext } from "./error-context";
import { Step } from "./step";
import type {
	FullFlowRouteData,
	ModelMetadata,
	Transitions,
} from "./types";
import { Back } from "./router";

export function requiresSyntheticModelPrefix({
	baseUrl,
	provider,
}: {
	baseUrl: string;
	provider?: Pick<ProviderConfig, "name">;
}): boolean {
	if (!SYNTHETIC_PROVIDER) return false;
	if (provider && keyFromName(provider.name).success) {
		return provider.name === SYNTHETIC_PROVIDER.name;
	}
	return providerForBaseUrl(baseUrl)?.name === SYNTHETIC_PROVIDER.name;
}

function parseModelInput(value: string): string {
	return value;
}

function modelInputIsValid(
	value: string,
	props: Pick<FullFlowRouteData["model"], "baseUrl" | "provider">,
) {
	if (requiresSyntheticModelPrefix(props) && !value.startsWith("hf:")) {
		return {
			valid: false as const,
			error: `Synthetic model names need to be prefixed with "hf:" (without the quotes)`,
		};
	}
	return { valid: true as const };
}

export function Model(props: FullFlowRouteData["model"] & Transitions<string>) {
	const propsRef = useLatestRef(props);
	const validateModelInput = useCallback(
		(value: string) => modelInputIsValid(value, propsRef.current),
		[propsRef],
	);
	const handleSubmit = useCallback(
		(model: string) => propsRef.current.onSubmit(model),
		[propsRef],
	);
	return (
		<Back go={props.back}>
			<Step<string>
				title="What's the model string for the API you're using?"
				prompt="Model string:"
				parse={parseModelInput}
				validate={validateModelInput}
				onSubmit={handleSubmit}
			>
				{props.renderExamples && (
					<Box marginBottom={1}>
						<Text>
							(For example, to use Kimi K2 with the Moonshot API, you would use
							kimi-k2-0711-preview)
						</Text>
					</Box>
				)}
				<Text>
					This varies by inference provider: you can typically find this
					information in your inference provider's documentation.
				</Text>
			</Step>
		</Back>
	);
}

export function TestConnection(
	props: FullFlowRouteData["testConnection"] & {
		errorNav: () => unknown;
	} & Transitions<ModelMetadata>,
) {
	const { setErrorMessage } = useContext(errorContext);
	const modelConnectionTest = useModelConnectionTest();
	const { auth, baseUrl, config, env, errorNav, model, onSubmit, provider } =
		props;
	const errorNavRef = useLatestRef(errorNav);
	const onSubmitRef = useLatestRef(onSubmit);
	const setErrorMessageRef = useLatestRef(setErrorMessage);
	const authKey = useMemo(() => authConnectionKey(auth), [auth]);
	const configAuthKey = useMemo(
		() => configAuthConnectionKey(config),
		[config],
	);
	const envKey = useMemo(() => envConnectionKey(env), [env]);
	const providerKey = useMemo(
		() => providerConnectionKey(provider),
		[provider],
	);
	const width = useTerminalContentWidth();
	useEffect(() => {
		let alive = true;
		testConnection({
			model,
			auth,
			baseUrl,
			provider,
			config,
			modelConnectionTest,
			env,
		}).then((result) => {
			if (!alive) return;
			if (result.valid) {
				onSubmitRef.current(result.metadata);
				return;
			}
			setErrorMessageRef.current(result.errorMessage ?? "Connection failed.");
			errorNavRef.current();
		});
		return () => {
			alive = false;
		};
	}, [
		authKey,
		baseUrl,
		configAuthKey,
		envKey,
		model,
		modelConnectionTest,
		providerKey,
	]);

	return (
		<Back go={props.back}>
			<Box
				flexDirection="column"
				justifyContent="center"
				alignItems="center"
				marginTop={1}
			>
				<Box flexDirection="column" width={width}>
					<Text color="yellow" bold={true}>
						Testing connection...
					</Text>
				</Box>
			</Box>
		</Back>
	);
}

function authConnectionKey(auth: FullFlowRouteData["testConnection"]["auth"]) {
	if (!auth) return "";
	if (auth.type === "env") {
		return `env\u001f${auth.name}\u001f${auth.credential ?? ""}`;
	}
	return `command\u001f${auth.command.join("\u001f")}`;
}

function configAuthConnectionKey(
	config: FullFlowRouteData["testConnection"]["config"],
): string {
	return sortedRecordConnectionKey(config?.defaultApiKeyOverrides);
}

function envConnectionKey(
	env: FullFlowRouteData["testConnection"]["env"],
): string {
	return sortedRecordConnectionKey(env);
}

function sortedRecordConnectionKey(
	record: Record<string, string | undefined> | undefined,
): string {
	if (!record) return "";
	const keys = Object.keys(record).sort();
	const parts = new Array<string>(keys.length);
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		parts[index] = `${key}\u001f${record[key] ?? ""}\u001e`;
	}
	return parts.join("");
}

function providerConnectionKey(
	provider: FullFlowRouteData["testConnection"]["provider"],
) {
	if (!provider) return "";
	return `${provider.name}\u001f${provider.type ?? ""}\u001f${provider.baseUrl}`;
}

export function formatContextTokens(tokens: number): string {
	const halfTokens = tokens / 2;
	const kValue = Math.round(halfTokens / 1024);
	return `${kValue}k`;
}

function parseContextTokens(value: string): number {
	let tokens = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 107) continue;
		tokens = tokens * 10 + code - 48;
	}
	return tokens * 1024;
}

function isContextTokenInput(value: string): boolean {
	let removedK = false;
	let digitCount = 0;
	let index = 0;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 107 && !removedK) {
			removedK = true;
			index += 1;
			continue;
		}
		if (code < 48 || code > 57) return false;
		digitCount += 1;
		index += 1;
	}
	return digitCount > 0;
}

function validateContextTokenInput(value: string) {
	if (isContextTokenInput(value)) return { valid: true as const };
	return {
		valid: false as const,
		error: "Couldn't parse your input as a number: please try again",
	};
}

export function Context(
	props: FullFlowRouteData["context"] & Pick<Transitions<number>, "back">,
) {
	const color = useTerminalThemeColor();
	const { metadata } = props;
	const propsRef = useLatestRef(props);
	const defaultContext = metadata.contextLength
		? formatContextTokens(metadata.contextLength)
		: "";
	const handleSubmit = useCallback(
		(context: number) => {
			const { auth, baseUrl, done, model, nickname } = propsRef.current;
			done({
				baseUrl,
				model,
				nickname,
				context,
				auth,
			});
		},
		[propsRef],
	);
	return (
		<Back go={props.back}>
			<Step<number>
				title="What's the maximum number of tokens Octo should use per request?"
				prompt="Maximum tokens:"
				defaultValue={defaultContext}
				parse={parseContextTokens}
				validate={validateContextTokenInput}
				onSubmit={handleSubmit}
			>
				<Box flexDirection="column">
					<Text>
						You can usually find this information in the documentation for the
						model on your inference company's website.
					</Text>
					<Box marginY={1}>
						<Text>
							(This is an estimate: leave some buffer room. Best performance is
							often at half the number of tokens supported by the API.)
						</Text>
					</Box>
					<Text>
						Format the number in k: for example, <Text color={color}>32k</Text>{" "}
						or, <Text color={color}>64k</Text>.
					</Text>
				</Box>
			</Step>
		</Back>
	);
}
