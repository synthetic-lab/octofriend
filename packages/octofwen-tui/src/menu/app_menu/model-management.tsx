import { useInput } from "ink";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import {
	useConfig,
	useSetConfig,
} from "../../internal/configuration/react-context.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import { ModelSetup } from "../model_setup/auto-detect-models.tsx";

export function SetDefaultModelMenu({ onBack }: { onBack: () => void }) {
	const { setModelOverride, toggleMenu } = useAppStore(
		useShallow((state) => ({
			setModelOverride: state.setModelOverride,
			toggleMenu: state.toggleMenu,
		})),
	);

	const config = useConfig();
	const setConfig = useSetConfig();

	useInput((_, key) => {
		if (key.escape) onBack();
	});

	const numericItems = config.models.map((model) => {
		return {
			label: model.nickname,
			value: `model-${model.nickname}` as const,
		};
	});

	const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
		{
			type: "auto-list" as const,
			order: numericItems,
		},
		{
			type: "key" as const,
			mapping: {
				b: {
					label: "Back to main menu",
					value: "back",
				},
			},
		},
	];

	const onSelect = useCallback(
		async (item: Item<`model-${string}` | "back">) => {
			if (item.value === "back") {
				onBack();
				return;
			}
			const target = item.value.replace("model-", "");
			const model = config.models.find((m) => m.nickname === target);
			if (!model) return;
			const rest = config.models.filter((m) => m.nickname !== target);
			await setConfig({
				...config,
				models: [model, ...rest],
			});
			setModelOverride(target);
			toggleMenu();
		},
		[config, onBack, setConfig, setModelOverride, toggleMenu],
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
		useShallow((state) => ({
			setModelOverride: state.setModelOverride,
			toggleMenu: state.toggleMenu,
		})),
	);

	const config = useConfig();
	const setConfig = useSetConfig();

	useInput((_, key) => {
		if (key.escape) onBack();
	});

	const numericItems = config.models.map((model) => {
		return {
			label: model.nickname,
			value: `model-${model.nickname}` as const,
		};
	});

	const shortcutItems: ShortcutArray<`model-${string}` | "back"> = [
		{
			type: "auto-list" as const,
			order: numericItems,
		},
		{
			type: "key" as const,
			mapping: {
				b: {
					label: "Back to main menu",
					value: "back",
				},
			},
		},
	];

	const onSelect = useCallback(
		async (item: Item<`model-${string}` | "back">) => {
			if (item.value === "back") {
				onBack();
				return;
			}
			const target = item.value.replace("model-", "");
			const rest = config.models.filter((m) => m.nickname !== target);
			await setConfig({
				...config,
				models: [...rest],
			});
			const current = rest[0];
			setModelOverride(current.nickname);
			toggleMenu();
		},
		[config, onBack, setConfig, setModelOverride, toggleMenu],
	);

	return (
		<KbShortcutPanel
			title="Which model do you want to remove?"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		/>
	);
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
				models: [...config.models, ...models],
			});
			onRouteComplete();
		},
		[config, onRouteComplete, setConfig],
	);

	const onOverrideDefaultApiKey = useCallback(
		async (overrides: Record<string, string>) => {
			await setConfig({
				...config,
				defaultApiKeyOverrides: {
					...(config.defaultApiKeyOverrides || {}),
					...overrides,
				},
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
