import { Box, Text, useInput } from "ink";
import { useCallback, useReducer, useState } from "react";
import {
	type Item,
	KbShortcutPanel,
	type Keymap,
} from "../../input/shortcuts.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";
import {
	keyFromName,
	PROVIDERS,
	type ProviderConfig,
	type ProviderKey,
	providerEntries,
} from "../../internal/model-provider-catalog/main.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { MenuHeader } from "../root.tsx";
import {
	ThemedSelectIndicator as IndicatorComponent,
	ThemedSelectItem as ItemComponent,
	SelectInput,
} from "../select.tsx";
import {
	CustomAuthFlow,
	CustomModelFlow,
	FullAddModelFlow,
} from "./add-model-flow.tsx";
import { reduceModelSetupStep, resolveProviderEnvVar } from "./primitives.tsx";

export type AutoDetectModelsProps = {
	onComplete: (models: Config["models"]) => void;
	onCancel: () => void;
	onOverrideDefaultApiKey: (o: Record<string, string>) => Promise<unknown>;
	config: Config | null;
	titleOverride?: string;
};

export function ModelSetup({
	config,
	onComplete,
	onCancel,
	onOverrideDefaultApiKey,
	titleOverride,
}: AutoDetectModelsProps) {
	const [stepData, dispatch] = useReducer(reduceModelSetupStep, {
		step: "initial",
	});

	useInput((_, key) => {
		if (key.escape) {
			if (stepData.step === "initial") onCancel();
			else if (stepData.step !== "custom") {
				// custom handles its own cancellation
				dispatch({ force: true, to: { step: "initial" } });
			}
		}
	});

	const onChooseProvider = useCallback(
		(providerKey: ProviderKey) => {
			const provider = PROVIDERS[providerKey];
			if (!provider) return;
			const envVar = resolveProviderEnvVar(provider, config, null);
			if (process.env[envVar]) {
				return dispatch({
					from: "initial",
					to: {
						step: "found",
						provider,
						overrideAuth: null,
						useEnvVar: true,
					},
				});
			}
			return dispatch({
				from: "initial",
				to: {
					step: "missing",
					provider,
				},
			});
		},
		[config],
	);

	const onChooseCustom = useCallback(() => {
		dispatch({ from: "initial", to: { step: "custom" } });
	}, []);

	switch (stepData.step) {
		case "initial":
			return (
				<FastProviderList
					onChooseCustom={onChooseCustom}
					onChooseProvider={onChooseProvider}
					onBack={onCancel}
					titleOverride={titleOverride}
				/>
			);

		case "custom":
			return (
				<FullAddModelFlow
					config={config}
					onComplete={(model) => onComplete([model])}
					onCancel={() => {
						dispatch({
							from: "custom",
							to: { step: "initial" },
						});
					}}
				/>
			);

		case "found":
			return (
				<ImportModelsFrom
					config={config}
					provider={stepData.provider}
					onImport={(models) => {
						onComplete(
							models.map((model) => {
								let t: Partial<Config["models"][number]> = {};
								if (stepData.provider.type)
									t = { type: stepData.provider.type };
								const base: Config["models"][number] = {
									...model,
									nickname: `${model.nickname} (${stepData.provider.name})`,
									baseUrl: stepData.provider.baseUrl,
									...t,
								};
								if (stepData.overrideAuth) {
									base.auth = stepData.overrideAuth;
								} else if (stepData.useEnvVar) {
									base.apiEnvVar = resolveProviderEnvVar(
										stepData.provider,
										config,
										null,
									);
								}
								return base;
							}),
						);
					}}
					onCancel={() => {
						dispatch({ from: "found", to: { step: "initial" } });
					}}
					onCustomModel={() => {
						dispatch({
							from: "found",
							to: {
								step: "override-model-string",
								provider: stepData.provider,
								overrideAuth: stepData.overrideAuth,
								useEnvVar: stepData.useEnvVar,
							},
						});
					}}
				/>
			);

		case "missing":
			return (
				<CustomAuthFlow
					config={config}
					onComplete={async (auth) => {
						if (auth && auth.type === "env") {
							const key = keyFromName(stepData.provider.name);
							if (key.success) {
								await onOverrideDefaultApiKey({
									[key.data]: auth.name,
								});
							}
						}
						dispatch({
							from: "missing",
							to: {
								step: "found",
								provider: stepData.provider,
								overrideAuth: auth || null,
								useEnvVar: false,
							},
						});
					}}
					onCancel={() => {
						dispatch({ from: "missing", to: { step: "initial" } });
					}}
					baseUrl={stepData.provider.baseUrl}
				/>
			);

		case "override-model-string":
			return (
				<CustomModelFlow
					config={config}
					onComplete={(model) => {
						const modelClone = { ...model };
						if (stepData.provider.type) {
							modelClone.type = stepData.provider.type;
						}
						onComplete([modelClone]);
					}}
					onCancel={() => {
						dispatch({
							from: "override-model-string",
							to: {
								step: "found",
								provider: stepData.provider,
								overrideAuth: stepData.overrideAuth,
								useEnvVar: stepData.useEnvVar,
							},
						});
					}}
					baseUrl={stepData.provider.baseUrl}
					auth={
						stepData.overrideAuth ||
						(stepData.useEnvVar
							? { type: "env", name: stepData.provider.envVar }
							: undefined)
					}
				/>
			);
		default:
			return null;
	}
}

function FastProviderList({
	onChooseCustom,
	onChooseProvider,
	onBack,
	titleOverride,
}: {
	onChooseProvider: (provider: ProviderKey) => void;
	onChooseCustom: () => void;
	onBack: () => void;
	titleOverride?: string;
}) {
	const providerItems = providerEntries().map(([key, provider]) => ({
		label: provider.name,
		value: key,
		shortcut: provider.shortcut,
	}));

	const providerShortcuts: Keymap<ProviderKey> = {};
	for (const item of providerItems) {
		providerShortcuts[item.shortcut] = {
			label: item.label,
			value: item.value,
		};
	}

	type ProviderValue = ProviderKey | "custom" | "back";
	const items: Keymap<ProviderValue> = {
		...providerShortcuts,
		c: {
			label: "Add a custom model...",
			value: "custom" as const,
		},
		b: {
			label: "Back",
			value: "back" as const,
		},
	};

	const onSelect = useCallback((item: Item<ProviderValue>) => {
		if (item.value === "custom") return onChooseCustom();
		if (item.value === "back") return onBack();
		onChooseProvider(item.value);
	}, []);

	return (
		<KbShortcutPanel
			title={titleOverride || "Choose a model provider:"}
			shortcutItems={[{ type: "key" as const, mapping: items }]}
			onSelect={onSelect}
		/>
	);
}

function ImportModelsFrom({
	config,
	provider,
	onImport,
	onCancel,
	onCustomModel,
}: {
	config: Config | null;
	provider: ProviderConfig;
	onImport: (m: ProviderConfig["models"]) => void;
	onCustomModel: () => void;
	onCancel: () => void;
}) {
	const [selectedModels, setSelectedModels] = useState<string[]>([]);
	const remainingModels = getRemainingProviderModels(config, provider);

	const items = remainingModels.map((model) => {
		const isSelected = selectedModels.includes(model.nickname);
		const label = isSelected ? `⦿ ${model.nickname}` : `○ ${model.nickname}`;
		return {
			label,
			value: model.nickname,
		};
	});

	if (selectedModels.length > 0) {
		items.push({
			label: "Import selected models",
			value: "import" as const,
		});
	}
	items.push({
		label: "Import a custom model string...",
		value: "custom" as const,
	});
	items.push({
		label: "Back",
		value: "back" as const,
	});

	const onSelect = useCallback(
		(item: (typeof items)[number]) => {
			if (item.value === "custom") return onCustomModel();
			if (item.value === "back") return onCancel();
			if (item.value === "import") {
				const models = provider.models.filter((m) => {
					return selectedModels.includes(m.nickname);
				});
				onImport(models);
				return;
			}
			const nickname = item.value;
			if (selectedModels.includes(nickname)) {
				setSelectedModels(selectedModels.filter((m) => m !== nickname));
			} else {
				setSelectedModels([...selectedModels, nickname]);
			}
		},
		[selectedModels],
	);

	if (remainingModels.length === 0) {
		return (
			<CenteredBox>
				<KbShortcutPanel
					title={`You already imported all our recommended models from ${provider.name}!`}
					shortcutItems={[
						{
							type: "key" as const,
							mapping: {
								c: {
									label: `Add a custom model string from ${provider.name}`,
									value: "custom" as const,
								},
								b: {
									label: "Back",
									value: "back" as const,
								},
							},
						},
					]}
					onSelect={(item) => {
						if (item.value === "custom") return onCustomModel();
						return onCancel();
					}}
				/>
			</CenteredBox>
		);
	}

	return (
		<CenteredBox>
			<MenuHeader title={`${provider.name} models can be imported!`} />

			<Box marginBottom={1}>
				<Text>Which of the following models would you like to import?</Text>
			</Box>

			<SelectInput
				items={items}
				onSelect={onSelect}
				indicatorComponent={IndicatorComponent}
				itemComponent={ItemComponent}
			/>
		</CenteredBox>
	);
}

function getRemainingProviderModels(
	config: Config | null,
	provider: ProviderConfig,
): ProviderConfig["models"] {
	if (config == null) return provider.models;
	return provider.models.filter(
		(model) => !hasStoredProviderModel(config, provider, model.model),
	);
}

function hasStoredProviderModel(
	config: Config,
	provider: ProviderConfig,
	modelName: string,
): boolean {
	return config.models.some(
		(storedModel) =>
			storedModel.baseUrl === provider.baseUrl &&
			storedModel.model === modelName,
	);
}
