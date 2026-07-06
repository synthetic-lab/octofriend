import { useInput } from "ink";
import React, { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import { readKeyForModel } from "../../internal/configuration/keys.ts";
import { useConfig } from "../../internal/configuration/react-context.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import { SetApiKey } from "../model_setup/primitives.tsx";
import { useMenuState } from "./menu-state.ts";

export function SwitchModelMenu() {
	const { setModelOverride, toggleMenu } = useAppStore(
		useShallow((state) => ({
			setModelOverride: state.setModelOverride,
			toggleMenu: state.toggleMenu,
		})),
	);

	const { setMenuMode } = useMenuState(
		useShallow((state) => ({
			setMenuMode: state.setMenuMode,
		})),
	);

	const config = useConfig();
	const [pendingModel, setPendingModel] = React.useState<
		null | Config["models"][number]
	>(null);

	useInput((_, key) => {
		if (key.escape && pendingModel == null) setMenuMode("main-menu");
	});

	const onSelect = useCallback(
		async (item: Item<`model-${string}` | "back">) => {
			if (item.value === "back") {
				setMenuMode("main-menu");
				return;
			}

			const target = item.value.replace("model-", "");
			const model = config.models.find((m) => m.nickname === target);
			if (!model) return;

			if (!model.apiEnvVar) {
				const key = await readKeyForModel(model, config);
				if (key == null) {
					setPendingModel(model);
					return;
				}
			}

			setModelOverride(target);
			setMenuMode("main-menu");
			toggleMenu();
		},
		[config, setMenuMode, setModelOverride, toggleMenu],
	);

	if (pendingModel) {
		return (
			<SetApiKey
				baseUrl={pendingModel.baseUrl}
				onComplete={() => {
					setModelOverride(pendingModel.nickname);
					setPendingModel(null);
					setMenuMode("main-menu");
					toggleMenu();
				}}
				onCancel={() => {
					setPendingModel(null);
				}}
			/>
		);
	}

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

	return (
		<KbShortcutPanel
			title="Which model should Octo use now?"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		/>
	);
}
