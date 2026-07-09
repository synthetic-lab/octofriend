import { useCallback, useMemo } from "react";
import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import type {
	ProviderConfig,
	ProviderKey,
} from "../../internal/model-provider-catalog/main.ts";
import { CustomModelFlow, FullAddModelFlow } from "./add-model-flow.tsx";
import { CustomAuthFlow } from "./custom-auth-flow.tsx";
import { defaultApiKeyOverrideForProviderAuth } from "./provider-auth.ts";
import { buildCustomProviderModel } from "./provider-import.ts";
import {
	buildImportedProviderModels,
	providerImportAuthText,
	providerModelAuth,
} from "./provider-import-auth.ts";
import { ImportModelsFrom } from "./provider-import-screen.tsx";
import { modelSetupStepForProviderChoice } from "./provider-selection.ts";
import { FastProviderList } from "./provider-selection-screen.tsx";
import type {
	ModelSetupStepAction,
	ModelSetupStepData,
} from "./setup-state.ts";

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
					provider,
					config,
					overrideAuth,
					useEnvVar,
				}),
			);
		},
		[config, onComplete, overrideAuth, provider, useEnvVar],
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
			provider={provider}
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
