import type { Item, ShortcutArray } from "../../input/shortcuts";
import type { Config } from "../../runtime/config/schemas";
import {
	normalizeProviderBaseUrl,
	type ProviderConfig,
	providerForModelConfig,
} from "../../runtime/models/catalog/main";

export type ImportModelValue =
	| `provider-model:${string}`
	| "import"
	| "custom"
	| "change-auth"
	| "back";

const PROVIDER_MODEL_VALUE_PREFIX = "provider-model:";
type SelectedProviderModelSet = ReadonlySet<string>;
type MutableProviderModelSet = Set<string>;
export const EMPTY_SELECTED_PROVIDER_MODELS: SelectedProviderModelSet =
	new Set<string>();

function providerModelValue(modelId: string): `provider-model:${string}` {
	return `${PROVIDER_MODEL_VALUE_PREFIX}${modelId}`;
}

export function providerModelSelectionKey(
	value: `provider-model:${string}`,
): string {
	return value.slice(PROVIDER_MODEL_VALUE_PREFIX.length);
}

export type EmptyProviderImportValue = "custom" | "change-auth" | "back";

export function buildEmptyProviderImportShortcutItems(
	providerName: string,
): ShortcutArray<EmptyProviderImportValue> {
	return [
		{
			type: "key" as const,
			mapping: {
				c: {
					label: `Add a custom model string from ${providerName}`,
					value: "custom",
				},
				a: {
					label: "Change authentication...",
					value: "change-auth",
				},
				b: {
					label: "Back",
					value: "back",
				},
			},
		},
	];
}

function appendProviderModelItems(
	items: Item<ImportModelValue>[],
	remainingModels: ProviderConfig["models"],
	selectedModelSet: SelectedProviderModelSet,
): { nextIndex: number; visibleSelectedCount: number } {
	let modelIndex = 0;
	let itemIndex = 0;
	let visibleSelectedCount = 0;
	while (modelIndex < remainingModels.length) {
		const model = remainingModels[modelIndex];
		modelIndex += 1;
		if (model === undefined) continue;
		const isSelected = selectedModelSet.has(model.model);
		if (isSelected) visibleSelectedCount += 1;
		items[itemIndex] = {
			label: `${isSelected ? "⦿" : "○"} ${model.nickname}`,
			value: providerModelValue(model.model),
		};
		itemIndex += 1;
	}
	return { nextIndex: itemIndex, visibleSelectedCount };
}

function appendUnselectedProviderModelItems(
	items: Item<ImportModelValue>[],
	remainingModels: ProviderConfig["models"],
): number {
	let modelIndex = 0;
	let itemIndex = 0;
	while (modelIndex < remainingModels.length) {
		const model = remainingModels[modelIndex];
		modelIndex += 1;
		if (model === undefined) continue;
		items[itemIndex] = {
			label: `○ ${model.nickname}`,
			value: providerModelValue(model.model),
		};
		itemIndex += 1;
	}
	return itemIndex;
}

function appendImportControlItems(
	items: Item<ImportModelValue>[],
	itemIndex: number,
	visibleSelectedCount: number,
): number {
	let nextIndex = itemIndex;
	if (visibleSelectedCount > 0) {
		items[nextIndex] = {
			label: "Import selected models",
			value: "import",
		};
		nextIndex += 1;
	}
	items[nextIndex] = {
		label: "Import a custom model string...",
		value: "custom",
	};
	nextIndex += 1;
	items[nextIndex] = {
		label: "Change authentication...",
		value: "change-auth",
	};
	nextIndex += 1;
	items[nextIndex] = {
		label: "Back",
		value: "back",
	};
	return nextIndex + 1;
}

export function buildImportModelItems(
	remainingModels: ProviderConfig["models"],
	selectedModelSet: SelectedProviderModelSet,
): Item<ImportModelValue>[] {
	const items = new Array<Item<ImportModelValue>>(remainingModels.length + 4);
	if (selectedModelSet.size === 0) {
		items.length = appendImportControlItems(
			items,
			appendUnselectedProviderModelItems(items, remainingModels),
			0,
		);
		return items;
	}
	const { nextIndex, visibleSelectedCount } = appendProviderModelItems(
		items,
		remainingModels,
		selectedModelSet,
	);
	items.length = appendImportControlItems(
		items,
		nextIndex,
		visibleSelectedCount,
	);
	return items;
}

export function selectedProviderModels(
	remainingModels: ProviderConfig["models"],
	selectedModelSet: SelectedProviderModelSet,
): ProviderConfig["models"] {
	const selected = new Array<ProviderConfig["models"][number]>(
		Math.min(remainingModels.length, selectedModelSet.size),
	);
	let index = 0;
	let selectedIndex = 0;
	while (index < remainingModels.length) {
		const model = remainingModels[index];
		index += 1;
		if (model !== undefined && selectedModelSet.has(model.model)) {
			selected[selectedIndex] = model;
			selectedIndex += 1;
		}
	}
	selected.length = selectedIndex;
	return selected;
}

export function toggleSelectedProviderModel(
	current: SelectedProviderModelSet,
	modelId: string,
): SelectedProviderModelSet {
	const toggled = new Set(current);
	if (toggled.has(modelId)) toggled.delete(modelId);
	else toggled.add(modelId);
	return toggled.size === 0 ? EMPTY_SELECTED_PROVIDER_MODELS : toggled;
}

export function buildCustomProviderModel(
	model: Config["models"][number],
	provider: ProviderConfig,
): Config["models"][number] {
	if (!provider.type) return model;
	return { ...model, type: provider.type };
}

export function getRemainingProviderModels(
	config: Config | null,
	provider: ProviderConfig,
): ProviderConfig["models"] {
	if (config == null || config.models.length === 0) return provider.models;
	const storedModelNames = storedProviderModelNames(config, provider);
	const remaining = new Array<ProviderConfig["models"][number]>(
		provider.models.length,
	);
	let index = 0;
	let writeIndex = 0;
	while (index < provider.models.length) {
		const model = provider.models[index];
		if (model !== undefined && !storedModelNames.has(model.model)) {
			remaining[writeIndex] = model;
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < remaining.length) remaining.length = writeIndex;
	return remaining;
}

function storedProviderModelNames(
	config: Config,
	provider: ProviderConfig,
): MutableProviderModelSet {
	const names: MutableProviderModelSet = new Set();
	const providerBaseUrls = providerBaseUrlSet(provider);
	let index = 0;
	while (index < config.models.length) {
		const storedModel = config.models[index];
		if (
			storedModel !== undefined &&
			storedModelMatchesProvider(storedModel, provider, providerBaseUrls)
		) {
			names.add(storedModel.model);
		}
		index += 1;
	}
	return names;
}

function providerBaseUrlSet(provider: ProviderConfig): MutableProviderModelSet {
	const baseUrls: MutableProviderModelSet = new Set();
	baseUrls.add(normalizeProviderBaseUrl(provider.baseUrl));
	for (let index = 0; index < provider.baseUrlAliases.length; index += 1) {
		baseUrls.add(normalizeProviderBaseUrl(provider.baseUrlAliases[index]));
	}
	return baseUrls;
}

function storedModelMatchesProvider(
	storedModel: Config["models"][number],
	provider: ProviderConfig,
	providerBaseUrls: SelectedProviderModelSet,
): boolean {
	if (providerBaseUrls.has(normalizeProviderBaseUrl(storedModel.baseUrl))) {
		return true;
	}
	if (!storedModel.type || storedModel.type === "standard") return false;
	return providerForModelConfig(storedModel)?.name === provider.name;
}
