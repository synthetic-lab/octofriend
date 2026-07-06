import { Box, Text, useInput } from "ink";
import { errorToString } from "../../app/result.ts";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TextInput } from "../../input/text.ts";
import {
	readKeyForModel as readConfiguredKeyForModel,
	writeKeyForModel,
} from "../../internal/configuration/keys.ts";
import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import {
	testConnection,
	type ModelConnectionTester,
} from "./add-model-connection.ts";
import {
	keyFromName,
	type ProviderConfig,
	SYNTHETIC_PROVIDER,
	providerValues,
} from "../../internal/model-provider-catalog/main.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { MenuHeader } from "../root.tsx";

export const EMPTY_API_KEY_ERROR = "API key can't be empty";
export const API_KEY_WRITE_ERROR =
	"Write to key file failed. Is your filesystem corrupt?";

export type ApiKeyValidationResult =
	| { valid: true }
	| { valid: false; error: string };

export type ModelSetupStepData =
	| {
			step: "initial";
	  }
	| {
			step: "custom";
	  }
	| {
			step: "found";
			provider: ProviderConfig;
			overrideAuth: Auth | null;
			useEnvVar: boolean;
	  }
	| {
			step: "missing";
			provider: ProviderConfig;
	  }
	| {
			step: "override-model-string";
			provider: ProviderConfig;
			overrideAuth: Auth | null;
			useEnvVar: boolean;
	  };

export type ModelSetupStepAction =
	| {
			from: ModelSetupStepData["step"];
			to: ModelSetupStepData;
	  }
	| {
			force: true;
			to: ModelSetupStepData;
	  };

export type SetApiKeyProps = {
	nickname?: string;
	baseUrl: string;
	onComplete: (apiKey: string) => void | Promise<void>;
	onCancel: () => void;
};

export type AutofixDiffApplyConfig = Exclude<Config["diffApply"], undefined>;

export type SyntheticAutofixSelectionResult =
	| {
			step: "complete";
			diffApply: AutofixDiffApplyConfig;
	  }
	| {
			step: "missing-auth";
	  }
	| {
			step: "connection-failed";
			errorMessage: string;
	  };

export type ResolveSyntheticAutofixSelectionInput = {
	config: Pick<Config, "defaultApiKeyOverrides"> | null;
	defaultModel: string;
	env?: Record<string, string | undefined>;
	readKeyForModel?: (
		model: { baseUrl: string },
		config: Pick<Config, "defaultApiKeyOverrides"> | null,
	) => Promise<string | null>;
	modelConnectionTest?: ModelConnectionTester;
};

export type SyntheticAutofixConfig = {
	diffApply: AutofixDiffApplyConfig;
	fixJson: AutofixDiffApplyConfig;
};

export type SyntheticAutofixConfigResult =
	| { step: "complete"; config: SyntheticAutofixConfig }
	| { step: "missing-auth" }
	| { step: "connection-failed"; errorMessage: string };

export type ResolveSyntheticAutofixConfigInput = Omit<
	ResolveSyntheticAutofixSelectionInput,
	"defaultModel"
> & {
	diffApplyModel?: string;
	fixJsonModel?: string;
};

export type ResolveSyntheticAutofixSelectionFromAuthInput = {
	config: Config | null;
	defaultModel: string;
	auth?: Auth;
	modelConnectionTest?: ModelConnectionTester;
};

export type ResolveSyntheticAutofixConfigFromAuthInput = Omit<
	ResolveSyntheticAutofixSelectionFromAuthInput,
	"defaultModel"
> & {
	diffApplyModel?: string;
	fixJsonModel?: string;
};

export function getProviderDisplayName(baseUrl: string): string {
	const provider = providerValues().find((provider) => {
		return provider.baseUrl === baseUrl;
	});
	return provider?.name || baseUrl;
}

export function getProviderApiKeyUrl(baseUrl: string): string | null {
	const provider = providerValues().find((provider) => {
		return provider.baseUrl === baseUrl;
	});
	return provider?.apiKeyUrl ?? null;
}

export function terminalHyperlink(url: string, label = url): string {
	return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
}

export function validateApiKeyValue(value: string): ApiKeyValidationResult {
	if (value === "") {
		return { valid: false, error: EMPTY_API_KEY_ERROR };
	}
	return { valid: true };
}

export function resolveProviderEnvVar(
	provider: ProviderConfig,
	config: Pick<Config, "defaultApiKeyOverrides"> | null,
	overrideEnvVar: string | null,
): string {
	if (overrideEnvVar) return overrideEnvVar;
	const key = keyFromName(provider.name);
	if (key.success && config?.defaultApiKeyOverrides?.[key.data]) {
		return config.defaultApiKeyOverrides[key.data];
	}
	return provider.envVar;
}

export function reduceModelSetupStep(
	state: ModelSetupStepData,
	action: ModelSetupStepAction,
): ModelSetupStepData {
	if ("force" in action) return action.to;

	if (state.step === action.from) return action.to;
	return state;
}

export function syntheticAutofixDiffApplyFromAuth(
	defaultModel: string,
	auth?: Auth,
): AutofixDiffApplyConfig {
	const diffApply: AutofixDiffApplyConfig = {
		baseUrl: SYNTHETIC_PROVIDER.baseUrl,
		model: defaultModel,
	};
	if (auth) diffApply.auth = auth;
	return diffApply;
}

export async function resolveSyntheticAutofixConfig({
	diffApplyModel = "hf:syntheticlab/diff-apply",
	fixJsonModel = "hf:syntheticlab/fix-json",
	...input
}: ResolveSyntheticAutofixConfigInput): Promise<SyntheticAutofixConfigResult> {
	const diffApply = await resolveSyntheticAutofixSelection({
		...input,
		defaultModel: diffApplyModel,
	});
	if (diffApply.step !== "complete") return diffApply;

	const fixJson = await resolveSyntheticAutofixSelection({
		...input,
		defaultModel: fixJsonModel,
	});
	if (fixJson.step !== "complete") return fixJson;

	return {
		step: "complete",
		config: {
			diffApply: diffApply.diffApply,
			fixJson: fixJson.diffApply,
		},
	};
}

export async function resolveSyntheticAutofixConfigFromAuth({
	diffApplyModel = "hf:syntheticlab/diff-apply",
	fixJsonModel = "hf:syntheticlab/fix-json",
	...input
}: ResolveSyntheticAutofixConfigFromAuthInput): Promise<SyntheticAutofixConfigResult> {
	const diffApply = await resolveSyntheticAutofixSelectionFromAuth({
		...input,
		defaultModel: diffApplyModel,
	});
	if (diffApply.step !== "complete") return diffApply;

	const fixJson = await resolveSyntheticAutofixSelectionFromAuth({
		...input,
		defaultModel: fixJsonModel,
	});
	if (fixJson.step !== "complete") return fixJson;

	return {
		step: "complete",
		config: {
			diffApply: diffApply.diffApply,
			fixJson: fixJson.diffApply,
		},
	};
}

export async function resolveSyntheticAutofixSelectionFromAuth({
	config,
	defaultModel,
	auth,
	modelConnectionTest,
}: ResolveSyntheticAutofixSelectionFromAuthInput): Promise<SyntheticAutofixSelectionResult> {
	const connection = await testSyntheticAutofixAuth({
		config,
		auth,
		model: defaultModel,
		modelConnectionTest,
	});
	if (connection) return connection;
	return {
		step: "complete",
		diffApply: syntheticAutofixDiffApplyFromAuth(defaultModel, auth),
	};
}

export async function resolveSyntheticAutofixSelection({
	config,
	defaultModel,
	env = process.env,
	readKeyForModel: readKey,
	modelConnectionTest,
}: ResolveSyntheticAutofixSelectionInput): Promise<SyntheticAutofixSelectionResult> {
	const envVar = resolveProviderEnvVar(SYNTHETIC_PROVIDER, config, null);
	const envKey = env[envVar];
	if (envKey) {
		const connection = await testSyntheticAutofixConnection({
			apiKey: envKey,
			model: defaultModel,
			modelConnectionTest,
		});
		if (connection) return connection;
		return {
			step: "complete",
			diffApply: {
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				apiEnvVar: envVar,
				model: defaultModel,
			},
		};
	}

	const key = await (
		readKey ??
		((model) => readConfiguredKeyForModel(model, config as Config | null))
	)({ baseUrl: SYNTHETIC_PROVIDER.baseUrl }, config);
	if (key === null) return { step: "missing-auth" };
	const connection = await testSyntheticAutofixConnection({
		apiKey: key,
		model: defaultModel,
		modelConnectionTest,
	});
	if (connection) return connection;
	return {
		step: "complete",
		diffApply: syntheticAutofixDiffApplyFromAuth(defaultModel),
	};
}

async function testSyntheticAutofixConnection({
	apiKey,
	model,
	modelConnectionTest,
}: {
	apiKey: string;
	model: string;
	modelConnectionTest?: ModelConnectionTester;
}): Promise<Extract<
	SyntheticAutofixSelectionResult,
	{ step: "connection-failed" }
> | null> {
	if (!modelConnectionTest) return null;
	try {
		const result = await modelConnectionTest({
			baseUrl: SYNTHETIC_PROVIDER.baseUrl,
			apiKey,
			model,
		});
		if (result.valid) return null;
		return { step: "connection-failed", errorMessage: "Connection failed." };
	} catch (error) {
		return { step: "connection-failed", errorMessage: errorToString(error) };
	}
}

async function testSyntheticAutofixAuth({
	config,
	auth,
	model,
	modelConnectionTest,
}: {
	config: Config | null;
	auth?: Auth;
	model: string;
	modelConnectionTest?: ModelConnectionTester;
}): Promise<Extract<
	SyntheticAutofixSelectionResult,
	{ step: "connection-failed" }
> | null> {
	if (!modelConnectionTest) return null;
	const result = await testConnection({
		baseUrl: SYNTHETIC_PROVIDER.baseUrl,
		auth,
		config,
		model,
		modelConnectionTest,
	});
	if (result.valid) return null;
	return {
		step: "connection-failed",
		errorMessage: result.errorMessage ?? "Connection failed.",
	};
}

export function SetApiKey({ baseUrl, onComplete, onCancel }: SetApiKeyProps) {
	const name = getProviderDisplayName(baseUrl);
	const apiKeyUrl = getProviderApiKeyUrl(baseUrl);
	const [saving, setSaving] = useState(false);
	const [varValue, setVarValue] = useState("");
	const [errorMessage, setErrorMessage] = useState<null | string>(null);

	useInput((_, key) => {
		if (key.escape) onCancel();
	});

	const onValueChange = useCallback((value: string) => {
		setErrorMessage(null);
		setVarValue(value);
	}, []);

	const onSubmit = useCallback(() => {
		const validation = validateApiKeyValue(varValue);
		if (!validation.valid) {
			setErrorMessage(validation.error);
			return;
		}

		setSaving(true);
		writeKeyForModel({ baseUrl }, varValue).then(
			() => {
				setSaving(false);
				onComplete(varValue);
			},
			() => {
				setSaving(false);
				setErrorMessage(API_KEY_WRITE_ERROR);
			},
		);
	}, [baseUrl, onComplete, varValue]);

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
			{apiKeyUrl && <Text>Get one at {terminalHyperlink(apiKeyUrl)}</Text>}

			<Box marginY={1} width={80}>
				<Box marginRight={1}>
					<Text>API key:</Text>
				</Box>

				<TextInput
					value={varValue}
					onChange={onValueChange}
					onSubmit={onSubmit}
				/>
			</Box>
			{errorMessage && (
				<Box width={80}>
					<Text color="red" bold={true}>
						{errorMessage}
					</Text>
				</Box>
			)}
		</CenteredBox>
	);
}

export type Route<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
	TKey extends keyof TRoutes,
> = (router: ToRoute<TRoutes>) => React.FC<TRoutes[TKey]>;

export type ToRoute<TRoutes extends { [TRouteKey in keyof TRoutes]: object }> =
	{
		[TKey in keyof TRoutes]: (props: TRoutes[TKey]) => void;
	};

type RouterComponents<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
> = {
	[TKey in keyof TRoutes]: Route<TRoutes, TKey>;
};

export function router<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
>() {
	return {
		build: <TKey extends keyof TRoutes>(
			_: TKey,
			route: Route<TRoutes, TKey>,
		) => {
			return route;
		},
		withRoutes<TKey extends keyof TRoutes>(..._: TKey[]) {
			type Filtered = {
				[TFilteredKey in TKey]: TRoutes[TFilteredKey];
			};
			return {
				build: <TFilteredKey extends keyof Filtered>(
					_: TFilteredKey,
					route: Route<Filtered, TFilteredKey>,
				) => {
					return route;
				},
			};
		},
		route: (componentBuilders: RouterComponents<TRoutes>) => {
			return new RouteBuilder<TRoutes>(componentBuilders);
		},
	};
}

export function Back({
	go,
	children,
}: {
	go: () => void;
	children: React.ReactNode;
}) {
	useInput((_, key) => {
		if (key.escape) go();
	});
	return <>{children}</>;
}

export class RouteBuilder<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
> {
	Root: <TInitial extends keyof TRoutes>(initial: {
		route: TInitial;
		props: TRoutes[TInitial];
	}) => React.ReactNode;

	constructor(componentBuilders: RouterComponents<TRoutes>) {
		this.Root = <TInitial extends keyof TRoutes>(initial: {
			route: TInitial;
			props: TRoutes[TInitial];
		}) => {
			const router = useMemo(() => {
				return new TerminalModelSetupRouter(initial);
			}, []);

			const [current, setCurrent] = useState(router.current());

			const Current = useMemo(() => {
				const minirouter: Partial<ToRoute<TRoutes>> = {};
				for (const key of Object.keys(componentBuilders) as Array<
					keyof TRoutes
				>) {
					minirouter[key] = (props: TRoutes[typeof key]) => {
						router.route({
							from: current.route,
							to: key,
							props,
						});
					};
				}
				const builder = componentBuilders[current.route];
				return builder(minirouter as ToRoute<TRoutes>);
			}, [componentBuilders, current, router]);

			useEffect(() => {
				const listener = <TKey extends keyof TRoutes>(
					route: TKey,
					props: TRoutes[TKey],
				) => {
					setCurrent({ route, props });
				};
				router.addRouteListener(listener);
				setCurrent(router.current());
				return () => router.removeRouteListener(listener);
			}, [router]);

			return <Current {...current.props} />;
		};
	}
}

class TerminalModelSetupRouter<
	TRoutes extends { [TRouteKey in keyof TRoutes]: object },
	TInitial extends keyof TRoutes,
> {
	private _current: {
		route: keyof TRoutes;
		props: TRoutes[keyof TRoutes];
	};
	private _routeChangeCallbacks: Array<
		<TKey extends keyof TRoutes>(route: TKey, data: TRoutes[TKey]) => void
	> = [];

	constructor(initial: { route: TInitial; props: TRoutes[TInitial] }) {
		this._current = initial;
	}

	current() {
		return { ...this._current };
	}

	route<TKey extends keyof TRoutes>({
		from,
		to,
		props,
	}: {
		from: keyof TRoutes;
		to: TKey;
		props: TRoutes[TKey];
	}) {
		if (this._current.route === from) {
			this._current = { route: to, props };
			this.onRouteChange(to, props);
		}
	}

	addRouteListener(
		listener: <TKey extends keyof TRoutes>(
			route: TKey,
			props: TRoutes[TKey],
		) => void,
	) {
		this._routeChangeCallbacks.push(listener);
		return listener;
	}

	removeRouteListener(
		listener: <TKey extends keyof TRoutes>(
			route: TKey,
			props: TRoutes[TKey],
		) => void,
	) {
		const index = this._routeChangeCallbacks.indexOf(listener);
		if (index >= 0) this._routeChangeCallbacks.splice(index, 1);
	}

	private onRouteChange<TKey extends keyof TRoutes>(
		route: TKey,
		props: TRoutes[TKey],
	) {
		for (const callback of this._routeChangeCallbacks) {
			callback(route, props);
		}
	}
}
