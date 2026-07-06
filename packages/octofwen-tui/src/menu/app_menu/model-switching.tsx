import { Text, useInput } from "ink";
import React, { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import { readKeyForModelWithDetails } from "../../internal/configuration/keys.ts";
import { useConfig } from "../../internal/configuration/react-context.ts";
import type {
	Config,
	KeyResult,
} from "../../internal/configuration/schemas.ts";
import { SetApiKey } from "../model_setup/primitives.tsx";

type SwitchModelSelection =
	| { step: "back" }
	| { step: "none" }
	| { step: "switch"; nickname: string }
	| { step: "set-api-key"; model: Config["models"][number] }
	| { step: "auth-error"; message: string };

export async function resolveSwitchModelSelection({
	config,
	item,
	readKeyForModel = readKeyForModelWithDetails,
}: {
	config: Config;
	item: Item<`model-${string}` | "back">;
	readKeyForModel?: (
		model: Config["models"][number],
		config: Config,
	) => Promise<KeyResult>;
}): Promise<SwitchModelSelection> {
	if (item.value === "back") return { step: "back" };

	const target = item.value.replace("model-", "");
	const model = config.models.find((m) => m.nickname === target);
	if (!model) return { step: "none" };

	const keyResult = await readKeyForModel(model, config);
	if (keyResult.ok) return { step: "switch", nickname: target };

	if (Object.hasOwn(model, "apiEnvVar") || Object.hasOwn(model, "auth")) {
		return { step: "auth-error", message: keyResult.error.message };
	}
	return { step: "set-api-key", model };
}

export function SwitchModelMenu({ onBack }: { onBack: () => void }) {
	const { setModelOverride, toggleMenu } = useAppStore(
		useShallow((state) => ({
			setModelOverride: state.setModelOverride,
			toggleMenu: state.toggleMenu,
		})),
	);

	const config = useConfig();
	const [pendingModel, setPendingModel] = React.useState<
		null | Config["models"][number]
	>(null);
	const [authErrorMessage, setAuthErrorMessage] = React.useState<string | null>(
		null,
	);

	useInput((_, key) => {
		if (key.escape && pendingModel == null) onBack();
	});

	const onSelect = useCallback(
		async (item: Item<`model-${string}` | "back">) => {
			setAuthErrorMessage(null);
			const selection = await resolveSwitchModelSelection({ config, item });
			if (selection.step === "back") {
				onBack();
				return;
			}
			if (selection.step === "none") return;
			if (selection.step === "auth-error") {
				setAuthErrorMessage(selection.message);
				return;
			}
			if (selection.step === "set-api-key") {
				setPendingModel(selection.model);
				return;
			}

			setModelOverride(selection.nickname);
			toggleMenu();
		},
		[config, onBack, setModelOverride, toggleMenu],
	);

	if (pendingModel) {
		return (
			<SetApiKey
				baseUrl={pendingModel.baseUrl}
				onComplete={() => {
					setModelOverride(pendingModel.nickname);
					setPendingModel(null);
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
		>
			{authErrorMessage && <Text color="red">{authErrorMessage}</Text>}
		</KbShortcutPanel>
	);
}
