import { Text } from "ink";
import React, { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../shell/state/store";
import type { UiState } from "../../shell/state/types";
import { useLatestInput, useLatestRef } from "../../input/latest-input";
import { type Item, KbShortcutPanel } from "../../input/shortcuts";
import { readKeyForModelWithDetails } from "../../runtime/config/keys";
import { useConfig } from "../../runtime/config/react-context";
import type {
	Config,
	KeyResult,
} from "../../runtime/config/schemas";
import { providerForModelConfig } from "../../runtime/models/catalog/main";
import { normalizeRenderedLineBreaks } from "../../render/lines";
import { SetApiKey } from "../models/api-key";
import { buildModelShortcutItems } from "./models";

const switchModelMenuStateSelector = (state: UiState) => ({
	setModelOverride: state.setModelOverride,
	toggleMenu: state.toggleMenu,
});

type SwitchModelSelection =
	| { step: "back" }
	| { step: "none" }
	| { step: "switch"; nickname: string }
	| { step: "set-api-key"; model: Config["models"][number] }
	| { step: "auth-error"; message: string };

const MODEL_VALUE_PREFIX = "model-";

function modelNicknameFromValue(value: `model-${string}`): string {
	return value.slice(MODEL_VALUE_PREFIX.length);
}

function modelByNickname(
	models: Config["models"],
	nickname: string,
): Config["models"][number] | null {
	let index = 0;
	while (index < models.length) {
		const model = models[index];
		if (model?.nickname === nickname) return model;
		index += 1;
	}
	return null;
}

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

	const target = modelNicknameFromValue(item.value);
	const model = modelByNickname(config.models, target);
	if (!model) return { step: "none" };

	const keyResult = await readKeyForModel(model, config);
	if (keyResult.ok) return { step: "switch", nickname: target };

	if (modelHasConfiguredAuth(model)) {
		return { step: "auth-error", message: keyResult.error.message };
	}
	return { step: "set-api-key", model };
}

function modelHasConfiguredAuth(model: Config["models"][number]): boolean {
	if (model.auth !== undefined) return true;
	if (!Object.hasOwn(model, "apiEnvVar")) return false;
	return (
		typeof model.apiEnvVar === "string" && model.apiEnvVar.trim().length > 0
	);
}

export function SwitchModelMenu({ onBack }: { onBack: () => void }) {
	const { setModelOverride, toggleMenu } = useAppStore(
		useShallow(switchModelMenuStateSelector),
	);

	const config = useConfig();
	const configRef = useLatestRef(config);
	const onBackRef = useLatestRef(onBack);
	const setModelOverrideRef = useLatestRef(setModelOverride);
	const toggleMenuRef = useLatestRef(toggleMenu);
	const [pendingModel, setPendingModel] = React.useState<
		null | Config["models"][number]
	>(null);
	const [authErrorMessage, setAuthErrorMessage] = React.useState<string | null>(
		null,
	);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape && pendingModel == null) onBackRef.current();
			},
			[onBackRef, pendingModel],
		),
	);

	const onSelect = useCallback(
		async (item: Item<`model-${string}` | "back">) => {
			setAuthErrorMessage(null);
			const selection = await resolveSwitchModelSelection({
				config: configRef.current,
				item,
			});
			if (selection.step === "back") {
				onBackRef.current();
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

			setModelOverrideRef.current(selection.nickname);
			toggleMenuRef.current();
		},
		[configRef, onBackRef, setModelOverrideRef, toggleMenuRef],
	);

	const shortcutItems = useMemo(
		() => buildModelShortcutItems(config.models),
		[config.models],
	);

	const pendingProvider = useMemo(
		() =>
			pendingModel
				? (providerForModelConfig(pendingModel) ?? undefined)
				: undefined,
		[pendingModel],
	);

	const handlePendingComplete = useCallback(() => {
		if (!pendingModel) return;
		setModelOverrideRef.current(pendingModel.nickname);
		setPendingModel(null);
		toggleMenuRef.current();
	}, [pendingModel, setModelOverrideRef, toggleMenuRef]);

	const handlePendingCancel = useCallback(() => {
		setPendingModel(null);
	}, []);

	if (pendingModel) {
		return (
			<SetApiKey
				baseUrl={pendingModel.baseUrl}
				provider={pendingProvider}
				onComplete={handlePendingComplete}
				onCancel={handlePendingCancel}
			/>
		);
	}

	return (
		<KbShortcutPanel
			title="Which model should Octo use now?"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		>
			{authErrorMessage && (
				<Text color="red">{normalizeRenderedLineBreaks(authErrorMessage)}</Text>
			)}
		</KbShortcutPanel>
	);
}
