import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { assertKeyForModel } from "../../runtime/config/keys.ts";
import type { Auth, Config } from "../../runtime/config/schemas.ts";
import type {
	ProviderConfig,
	ProviderKey,
} from "../../runtime/models/catalog/main.ts";
import { defaultApiKeyOverrideForProviderAuth } from "./auth.ts";
import { ModelDiscoveryContext } from "./connection.ts";
import { CustomAuthFlow } from "./custom-auth.tsx";
import { CustomModelFlow, FullAddModelFlow } from "./flow.tsx";
import { buildCustomProviderModel } from "./import.ts";
import {
	buildImportedProviderModels,
	providerImportAuthText,
	providerModelAuth,
} from "./import-auth.ts";
import { ImportModelsFrom } from "./import-screen.tsx";
import { FastProviderList } from "./provider-screen.tsx";
import { modelSetupStepForProviderChoice } from "./provider-select.ts";
import type { ModelSetupStepAction, ModelSetupStepData } from "./state.ts";

export type ModelSetupDispatch = React.Dispatch<ModelSetupStepAction>;

type CompleteModels = (models: Config["models"]) => void;
type OverrideDefaultApiKey = (o: Record<string, string>) => Promise<unknown>;

export function ModelSetupInitialRoute({
	config,
	dispatch,
	onCancel,
	titleOverride,
	env,
}: {
	config: Config | null;
	dispatch: ModelSetupDispatch;
	onCancel: () => void;
	titleOverride?: string;
	env?: Record<string, string | undefined>;
}) {
	const onChooseProvider = useCallback(
		(providerKey: ProviderKey) => {
			const nextStep = modelSetupStepForProviderChoice({
				providerKey,
				config,
				env,
			});
			if (!nextStep) return;
			dispatch({ from: "initial", to: nextStep });
		},
		[config, dispatch, env],
	);

	const onChooseCustom = useCallback(() => {
		dispatch({ from: "initial", to: { step: "custom" } });
	}, [dispatch]);

	return (
		<FastProviderList
			onChooseCustom={onChooseCustom}
			onChooseProvider={onChooseProvider}
			onBack={onCancel}
			titleOverride={titleOverride}
			config={config}
			env={env}
		/>
	);
}

export function ModelSetupCustomRoute({
	config,
	dispatch,
	onComplete,
}: {
	config: Config | null;
	dispatch: ModelSetupDispatch;
	onComplete: CompleteModels;
}) {
	const completeCustomModelSetup = useCallback(
		(model: Config["models"][number]) => {
			onComplete([model]);
		},
		[onComplete],
	);

	const cancelCustomModelSetup = useCallback(() => {
		dispatch({
			from: "custom",
			to: { step: "initial" },
		});
	}, [dispatch]);

	return (
		<FullAddModelFlow
			config={config}
			onComplete={completeCustomModelSetup}
			onCancel={cancelCustomModelSetup}
		/>
	);
}

type FoundStepData = Extract<ModelSetupStepData, { step: "found" }>;

export function ModelSetupFoundRoute({
	config,
	dispatch,
	onComplete,
	stepData,
}: {
	config: Config | null;
	dispatch: ModelSetupDispatch;
	onComplete: CompleteModels;
	stepData: FoundStepData;
}) {
	const { provider, overrideAuth, useEnvVar } = stepData;
	const modelDiscover = useContext(ModelDiscoveryContext);
	const [discoveredModels, setDiscoveredModels] = useState<
		ProviderConfig["models"] | null
	>(null);
	useEffect(() => {
		let active = true;
		const auth =
			overrideAuth ??
			(useEnvVar ? { type: "env" as const, name: provider.envVar } : undefined);
		if (auth?.type === "env" && auth.credential === "chatgpt-oauth") {
			return () => {
				active = false;
			};
		}
		assertKeyForModel(
			{ baseUrl: provider.baseUrl, type: provider.type, auth },
			config,
		)
			.then((apiKey) =>
				modelDiscover({
					type: provider.type,
					baseUrl: provider.baseUrl,
					apiKey,
				}),
			)
			.then((result) => {
				const models = result.models.map((model) => ({
					model: model.id,
					nickname: model.name ?? model.id,
					context: model.context_length ?? 0,
				}));
				if (active && models.length > 0) setDiscoveredModels(models);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [config, modelDiscover, overrideAuth, provider, useEnvVar]);
	const importProvider = useMemo(
		() =>
			discoveredModels ? { ...provider, models: discoveredModels } : provider,
		[discoveredModels, provider],
	);
	const authSummaryText = useMemo(
		() =>
			providerImportAuthText({
				provider,
				config,
				overrideAuth,
				useEnvVar,
			}),
		[config, overrideAuth, provider, useEnvVar],
	);
	const importProviderModels = useCallback(
		(models: ProviderConfig["models"]) => {
			onComplete(
				buildImportedProviderModels({
					models,
					provider: importProvider,
					config,
					overrideAuth,
					useEnvVar,
				}),
			);
		},
		[config, importProvider, onComplete, overrideAuth, useEnvVar],
	);

	const cancelProviderImport = useCallback(() => {
		dispatch({ from: "found", to: { step: "initial" } });
	}, [dispatch]);

	const chooseCustomProviderModel = useCallback(() => {
		dispatch({
			from: "found",
			to: {
				step: "override-model-string",
				provider,
				overrideAuth,
				useEnvVar,
			},
		});
	}, [dispatch, overrideAuth, provider, useEnvVar]);

	const changeProviderAuth = useCallback(() => {
		dispatch({
			from: "found",
			to: { step: "missing", provider },
		});
	}, [dispatch, provider]);

	return (
		<ImportModelsFrom
			config={config}
			provider={importProvider}
			onImport={importProviderModels}
			onCancel={cancelProviderImport}
			onCustomModel={chooseCustomProviderModel}
			onChangeAuth={changeProviderAuth}
			authSummaryText={authSummaryText}
		/>
	);
}

export function ModelSetupMissingAuthRoute({
	config,
	dispatch,
	onOverrideDefaultApiKey,
	stepData,
	env,
}: {
	config: Config | null;
	dispatch: ModelSetupDispatch;
	onOverrideDefaultApiKey: OverrideDefaultApiKey;
	stepData: Extract<ModelSetupStepData, { step: "missing" }>;
	env?: Record<string, string | undefined>;
}) {
	const { provider } = stepData;
	const completeMissingAuth = useCallback(
		async (auth?: Auth) => {
			const defaultOverride = defaultApiKeyOverrideForProviderAuth(
				provider,
				auth,
			);
			if (defaultOverride) {
				await onOverrideDefaultApiKey(defaultOverride);
			}
			dispatch({
				from: "missing",
				to: {
					step: "found",
					provider,
					overrideAuth: auth || null,
					useEnvVar: false,
				},
			});
		},
		[dispatch, onOverrideDefaultApiKey, provider],
	);

	const cancelMissingAuth = useCallback(() => {
		dispatch({ from: "missing", to: { step: "initial" } });
	}, [dispatch]);

	return (
		<CustomAuthFlow
			config={config}
			hasExistingKey={async () => false}
			onComplete={completeMissingAuth}
			onCancel={cancelMissingAuth}
			baseUrl={provider.baseUrl}
			provider={provider}
			env={env}
		/>
	);
}

export function ModelSetupOverrideModelRoute({
	config,
	dispatch,
	onComplete,
	stepData,
}: {
	config: Config | null;
	dispatch: ModelSetupDispatch;
	onComplete: CompleteModels;
	stepData: Extract<ModelSetupStepData, { step: "override-model-string" }>;
}) {
	const { provider, overrideAuth, useEnvVar } = stepData;
	const completeCustomProviderModel = useCallback(
		(model: Config["models"][number]) => {
			onComplete([buildCustomProviderModel(model, provider)]);
		},
		[onComplete, provider],
	);

	const cancelCustomProviderModel = useCallback(() => {
		dispatch({
			from: "override-model-string",
			to: {
				step: "found",
				provider,
				overrideAuth,
				useEnvVar,
			},
		});
	}, [dispatch, overrideAuth, provider, useEnvVar]);

	const customProviderModelAuth = useMemo(
		() =>
			providerModelAuth({
				provider,
				config,
				overrideAuth,
				useEnvVar,
			}),
		[config, overrideAuth, provider, useEnvVar],
	);

	return (
		<CustomModelFlow
			config={config}
			onComplete={completeCustomProviderModel}
			onCancel={cancelCustomProviderModel}
			baseUrl={provider.baseUrl}
			provider={provider}
			auth={customProviderModelAuth}
		/>
	);
}
