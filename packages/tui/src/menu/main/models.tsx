import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLatestInput, useLatestRef } from "../../input/latest-input.ts";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import { mergeDefaultApiKeyOverrides } from "../../runtime/config/api-keys.ts";
import { useConfig, useSetConfig } from "../../runtime/config/react-context.ts";
import type { Config } from "../../runtime/config/schemas.ts";
import { useAppStore } from "../../shell/state/store.ts";
import type { UiState } from "../../shell/state/types.ts";
import { ModelSetup } from "../models/detect-models.tsx";

const modelManagementStateSelector = (state: UiState) => ({
	setModelOverride: state.setModelOverride,
	toggleMenu: state.toggleMenu,
});

type ModelMenuValue = `model-${string}` | "back";
const MODEL_VALUE_PREFIX = "model-";

const MODEL_MENU_BACK_SHORTCUT = {
	type: "key" as const,
	mapping: {
		b: {
			label: "Back to main menu",
			value: "back" as const,
		},
	},
};

export function buildModelShortcutItems(
	models: Config["models"],
): ShortcutArray<ModelMenuValue> {
	const numericItems = new Array<Item<ModelMenuValue>>(models.length);
	let index = 0;
	let writeIndex = 0;
	while (index < models.length) {
		const model = models[index];
		if (model !== undefined) {
			numericItems[writeIndex] = {
				label: model.nickname,
				value: `model-${model.nickname}`,
			};
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < numericItems.length) numericItems.length = writeIndex;
	return [
		{
			type: "auto-list" as const,
			order: numericItems,
		},
		MODEL_MENU_BACK_SHORTCUT,
	];
}

function modelNicknameFromValue(value: `model-${string}`): string {
	return value.slice(MODEL_VALUE_PREFIX.length);
}

function defaultModelOrder(
	models: Config["models"],
	target: string,
): Config["models"] | null {
	const ordered = new Array<Config["models"][number]>(models.length);
	let selected: Config["models"][number] | null = null;
	let writeIndex = 1;
	let index = 0;
	while (index < models.length) {
		const model = models[index];
		if (model !== undefined) {
			if (model.nickname === target) {
				selected = model;
			} else {
				ordered[writeIndex] = model;
				writeIndex += 1;
			}
		}
		index += 1;
	}
	if (selected === null) return null;
	ordered[0] = selected;
	if (writeIndex < ordered.length) ordered.length = writeIndex;
	return ordered;
}

function modelsWithoutNickname(
	models: Config["models"],
	target: string,
): Config["models"] {
	const remaining = new Array<Config["models"][number]>(models.length);
	let index = 0;
	let writeIndex = 0;
	while (index < models.length) {
		const model = models[index];
		if (model !== undefined && model.nickname !== target) {
			remaining[writeIndex] = model;
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < remaining.length) remaining.length = writeIndex;
	return remaining;
}

export function SetDefaultModelMenu({ onBack }: { onBack: () => void }) {
	const { setModelOverride, toggleMenu } = useAppStore(
		useShallow(modelManagementStateSelector),
	);

	const config = useConfig();
	const setConfig = useSetConfig();
	const configRef = useLatestRef(config);
	const onBackRef = useLatestRef(onBack);
	const setConfigRef = useLatestRef(setConfig);
	const setModelOverrideRef = useLatestRef(setModelOverride);
	const toggleMenuRef = useLatestRef(toggleMenu);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) onBackRef.current();
			},
			[onBackRef],
		),
	);

	const shortcutItems = useMemo(
		() => buildModelShortcutItems(config.models),
		[config.models],
	);

	const onSelect = useCallback(
		async (item: Item<ModelMenuValue>) => {
			if (item.value === "back") {
				onBackRef.current();
				return;
			}
			const currentConfig = configRef.current;
			const target = modelNicknameFromValue(item.value);
			const models = defaultModelOrder(currentConfig.models, target);
			if (models === null) return;
			await setConfigRef.current({
				...currentConfig,
				models,
			});
			setModelOverrideRef.current(target);
			toggleMenuRef.current();
		},
		[configRef, onBackRef, setConfigRef, setModelOverrideRef, toggleMenuRef],
	);

	return (
		<KbShortcutPanel
			title="Which model should be the default?"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		/>
	);
}

export function RemoveModelMenu({ onBack }: { onBack: () => void }) {
	const { setModelOverride, toggleMenu } = useAppStore(
		useShallow(modelManagementStateSelector),
	);

	const config = useConfig();
	const setConfig = useSetConfig();
	const configRef = useLatestRef(config);
	const onBackRef = useLatestRef(onBack);
	const setConfigRef = useLatestRef(setConfig);
	const setModelOverrideRef = useLatestRef(setModelOverride);
	const toggleMenuRef = useLatestRef(toggleMenu);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) onBackRef.current();
			},
			[onBackRef],
		),
	);

	const shortcutItems = useMemo(
		() => buildModelShortcutItems(config.models),
		[config.models],
	);

	const onSelect = useCallback(
		async (item: Item<ModelMenuValue>) => {
			if (item.value === "back") {
				onBackRef.current();
				return;
			}
			const currentConfig = configRef.current;
			const target = modelNicknameFromValue(item.value);
			const rest = modelsWithoutNickname(currentConfig.models, target);
			await setConfigRef.current({
				...currentConfig,
				models: rest,
			});
			const current = rest[0];
			if (current) setModelOverrideRef.current(current.nickname);
			toggleMenuRef.current();
		},
		[configRef, onBackRef, setConfigRef, setModelOverrideRef, toggleMenuRef],
	);

	return (
		<KbShortcutPanel
			title="Which model do you want to remove?"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		/>
	);
}

function appendModels(
	currentModels: Config["models"],
	modelsToAppend: Config["models"],
): Config["models"] {
	const nextModels = new Array<Config["models"][number]>(
		currentModels.length + modelsToAppend.length,
	);
	let writeIndex = appendDefinedModels(nextModels, 0, currentModels);
	writeIndex = appendDefinedModels(nextModels, writeIndex, modelsToAppend);
	if (writeIndex < nextModels.length) nextModels.length = writeIndex;
	return nextModels;
}

function appendDefinedModels(
	target: Config["models"],
	writeIndex: number,
	source: Config["models"],
): number {
	let index = 0;
	let nextWriteIndex = writeIndex;
	while (index < source.length) {
		const model = source[index];
		if (model !== undefined) {
			target[nextWriteIndex] = model;
			nextWriteIndex += 1;
		}
		index += 1;
	}
	return nextWriteIndex;
}

export function AddModelMenuFlow({
	onComplete: onRouteComplete,
	onCancel,
}: {
	onComplete: () => void;
	onCancel: () => void;
}) {
	const setConfig = useSetConfig();
	const config = useConfig();

	const onComplete = useCallback(
		async (models: Config["models"]) => {
			await setConfig({
				...config,
				models: appendModels(config.models, models),
			});
			onRouteComplete();
		},
		[config, onRouteComplete, setConfig],
	);

	const onOverrideDefaultApiKey = useCallback(
		async (overrides: Record<string, string>) => {
			const defaultApiKeyOverrides = mergeDefaultApiKeyOverrides(
				config.defaultApiKeyOverrides,
				overrides,
			);
			if (defaultApiKeyOverrides === config.defaultApiKeyOverrides) return;
			await setConfig({
				...config,
				defaultApiKeyOverrides,
			});
		},
		[config, setConfig],
	);

	return (
		<ModelSetup
			config={config}
			onComplete={onComplete}
			onCancel={onCancel}
			onOverrideDefaultApiKey={onOverrideDefaultApiKey}
		/>
	);
}
