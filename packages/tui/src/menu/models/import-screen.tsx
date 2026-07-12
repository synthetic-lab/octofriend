import { Box, Text } from "ink";
import { useCallback, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../../input/latest-input.ts";
import { type Item, KbShortcutPanel } from "../../input/shortcuts.tsx";
import { CenteredBox } from "../../layout/boxes.tsx";
import { normalizeRenderedLineBreaks } from "../../render/lines.ts";
import type { Config } from "../../runtime/config/schemas.ts";
import type { ProviderConfig } from "../../runtime/models/catalog/main.ts";
import { MenuHeader } from "../root.tsx";
import {
	ThemedSelectIndicator as IndicatorComponent,
	ThemedSelectItem as ItemComponent,
	SelectInput,
} from "../select.tsx";
import {
	buildEmptyProviderImportShortcutItems,
	buildImportModelItems,
	EMPTY_SELECTED_PROVIDER_MODELS,
	type EmptyProviderImportValue,
	getRemainingProviderModels,
	type ImportModelValue,
	providerModelSelectionKey,
	selectedProviderModels,
	toggleSelectedProviderModel,
} from "./import.ts";

type ProviderSelectionState = {
	providerKey: string;
	selectedModelSet: ReadonlySet<string>;
};

function providerSelectionKey(provider: ProviderConfig): string {
	return `${provider.name}\u001f${provider.baseUrl}`;
}

const EMPTY_PROVIDER_SELECTION_STATE: ProviderSelectionState = {
	providerKey: "",
	selectedModelSet: EMPTY_SELECTED_PROVIDER_MODELS,
};

export function ImportModelsFrom({
	config,
	provider,
	onImport,
	onCancel,
	onCustomModel,
	onChangeAuth,
	authSummaryText,
}: {
	config: Config | null;
	provider: ProviderConfig;
	onImport: (m: ProviderConfig["models"]) => void;
	onCustomModel: () => void;
	onChangeAuth: () => void;
	onCancel: () => void;
	authSummaryText?: string;
}) {
	const onCancelRef = useLatestRef(onCancel);
	const onChangeAuthRef = useLatestRef(onChangeAuth);
	const onCustomModelRef = useLatestRef(onCustomModel);
	const onImportRef = useLatestRef(onImport);
	const [selectionState, setSelectionState] = useState<ProviderSelectionState>(
		EMPTY_PROVIDER_SELECTION_STATE,
	);
	const remainingModels = useMemo(
		() => getRemainingProviderModels(config, provider),
		[config, provider],
	);
	const currentProviderKey = useMemo(
		() => providerSelectionKey(provider),
		[provider.name, provider.baseUrl],
	);
	const selectedModelSet =
		selectionState.providerKey === currentProviderKey
			? selectionState.selectedModelSet
			: EMPTY_SELECTED_PROVIDER_MODELS;
	const selectedModelSetRef = useRef(selectedModelSet);
	selectedModelSetRef.current = selectedModelSet;

	const items = useMemo(
		() => buildImportModelItems(remainingModels, selectedModelSet),
		[remainingModels, selectedModelSet],
	);

	const onSelect = useCallback(
		(item: Item<ImportModelValue>) => {
			if (item.value === "custom") return onCustomModelRef.current();
			if (item.value === "change-auth") return onChangeAuthRef.current();
			if (item.value === "back") return onCancelRef.current();
			if (item.value === "import") {
				onImportRef.current(
					selectedProviderModels(remainingModels, selectedModelSetRef.current),
				);
				return;
			}
			const modelId = providerModelSelectionKey(item.value);
			setSelectionState((current) => {
				const currentSet =
					current.providerKey === currentProviderKey
						? current.selectedModelSet
						: EMPTY_SELECTED_PROVIDER_MODELS;
				return {
					providerKey: currentProviderKey,
					selectedModelSet: toggleSelectedProviderModel(currentSet, modelId),
				};
			});
		},
		[
			onCancelRef,
			onChangeAuthRef,
			onCustomModelRef,
			onImportRef,
			remainingModels,
			currentProviderKey,
		],
	);

	const emptyProviderShortcutItems = useMemo(
		() => buildEmptyProviderImportShortcutItems(provider.name),
		[provider.name],
	);
	const onEmptyProviderSelect = useCallback(
		(item: Item<EmptyProviderImportValue>) => {
			if (item.value === "custom") return onCustomModelRef.current();
			if (item.value === "change-auth") return onChangeAuthRef.current();
			return onCancelRef.current();
		},
		[onCancelRef, onChangeAuthRef, onCustomModelRef],
	);

	if (remainingModels.length === 0) {
		return (
			<CenteredBox>
				<Box flexDirection="column">
					{authSummaryText && (
						<Text color="gray">
							{normalizeRenderedLineBreaks(authSummaryText)}
						</Text>
					)}
					<KbShortcutPanel
						title={`You already imported all our recommended models from ${provider.name}!`}
						shortcutItems={emptyProviderShortcutItems}
						onSelect={onEmptyProviderSelect}
					/>
				</Box>
			</CenteredBox>
		);
	}

	return (
		<CenteredBox>
			<MenuHeader title={`${provider.name} models can be imported!`} />

			<Box marginBottom={1} flexDirection="column">
				<Text>Which of the following models would you like to import?</Text>
				{authSummaryText && (
					<Text color="gray">
						{normalizeRenderedLineBreaks(authSummaryText)}
					</Text>
				)}
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
