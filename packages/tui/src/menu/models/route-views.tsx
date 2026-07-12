import { Box, Text } from "ink";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLatestRef } from "../../input/latest-input";
import {
	keyFromName,
	type ProviderConfig,
	providerForBaseUrl,
	SYNTHETIC_PROVIDER,
} from "../../runtime/models/catalog/main";
import { assertKeyForModel } from "../../runtime/config/keys";
import { useTerminalContentWidth } from "../../layout/viewport";
import { useTerminalThemeColor } from "../../theme/branding";
import {
	testConnection,
	useModelConnectionTest,
	ModelDiscoveryContext,
} from "./connection";
import { errorContext } from "./error-context";
import { Step } from "./step";
import { SelectInput } from "../../menu/select";
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
	const modelDiscover = useContext(ModelDiscoveryContext);
	const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
	const [manualEntry, setManualEntry] = useState(false);
	useEffect(() => {
		let active = true;
		if (!props.auth) return;
		if (props.auth.type === "env" && props.auth.credential === "chatgpt-oauth") {
			return () => { active = false; };
		}
		assertKeyForModel({ baseUrl: props.baseUrl, auth: props.auth, type: props.provider?.type }, props.config)
			.then((apiKey) => modelDiscover({ type: props.provider?.type, baseUrl: props.baseUrl, apiKey }))
			.then((result) => {
				if (active) setDiscoveredModels(result.models.map((model) => model.id));
			})
			.catch(() => undefined);
		return () => { active = false; };
	}, [modelDiscover, props.auth, props.baseUrl, props.config, props.provider?.type]);
	const validateModelInput = useCallback(
		(value: string) => modelInputIsValid(value, propsRef.current),
		[propsRef],
	);
	const handleSubmit = useCallback(
		(model: string) => propsRef.current.onSubmit(model),
		[propsRef],
	);
	if (discoveredModels.length > 0 && !manualEntry) {
		return (
			<Back go={props.back}>
				<Box flexDirection="column" alignItems="center" marginTop={1}>
					<Text>Choose a model from this provider:</Text>
					<SelectInput
						items={[
							...discoveredModels.map((model) => ({ label: model, value: model })),
							{ label: "Enter a custom model string...", value: "__custom__" },
						]}
						onSelect={({ value }) => value === "__custom__" ? setManualEntry(true) : handleSubmit(value)}
					/>
				</Box>
			</Back>
		);
	}
	return (
		<Back go={props.back}>
			<Step<string> title="What's the model string for the API you're using?" prompt="Model string:" parse={parseModelInput} validate={validateModelInput} onSubmit={handleSubmit}>
				{props.renderExamples && <Text>(For example, to use Kimi K2 with the Moonshot API, you would use kimi-k2-0711-preview)</Text>}
				<Text>This varies by inference provider: you can typically find this information in your inference provider's documentation.</Text>
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

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;

export function formatContextTokens(tokens: number): string {
	return String(Math.round(tokens / 2));
}

function parseContextTokens(value: string): number {
	return Number(value);
}

function validateContextTokenInput(value: string) {
	if (
		POSITIVE_INTEGER_PATTERN.test(value) &&
		Number.isSafeInteger(Number(value))
	) {
		return { valid: true as const };
	}
	return {
		valid: false as const,
		error: "Enter the full token count as a positive integer",
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
						Enter the full token count without a unit suffix: for example,{" "}
						<Text color={color}>32000</Text> or{" "}
						<Text color={color}>64000</Text>.
					</Text>
				</Box>
			</Step>
		</Back>
	);
}
