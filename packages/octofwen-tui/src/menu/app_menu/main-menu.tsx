import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import type { UiState } from "../../app/state/types.ts";
import { useLatestInput, useLatestRef } from "../../input/latest_input.ts";
import {
	type Item,
	KbShortcutPanel,
	type Keymap,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import { selectModelFromConfig } from "../../internal/configuration/model-selection.ts";
import {
	useConfig,
	useSetConfig,
} from "../../internal/configuration/react-context.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import {
	providerForBaseUrl,
	SYNTHETIC_PROVIDER,
} from "../../internal/model-provider-catalog/main.ts";
import { MenuQuotaIndicator } from "../quota.tsx";
import { hasSettingsItems } from "./settings-menu.tsx";

type Value =
	| "model-select"
	| "add-model"
	| "vim-toggle"
	| "return"
	| "quit"
	| "fix-json-toggle"
	| "diff-apply-toggle"
	| "settings-menu"
	| "clear-confirm"
	| "notifications-menu";

export type MainMenuNavigate = {
	settingsMenu: () => void;
	modelSelect: () => void;
	addModel: () => void;
	diffApplyToggle: () => void;
	fixJsonToggle: () => void;
	quitConfirm: () => void;
	clearConfirm: () => void;
	notificationsMenu: () => void;
};

type MainMenuSelectContext = {
	config: Config;
	notify: (message: string) => void;
	onNavigate: MainMenuNavigate;
	resetPreMenuVimMode: () => void;
	setConfig: (config: Config) => Promise<unknown>;
	toggleMenu: () => void;
};

type MainMenuShortcutState = {
	vimEnabled: boolean;
	fixJsonUnset: boolean;
	diffApplyUnset: boolean;
	hasSettings: boolean;
};

const mainMenuStateSelector = (state: UiState) => ({
	toggleMenu: state.toggleMenu,
	notify: state.notify,
	resetPreMenuVimMode: state.resetPreMenuVimMode,
	quotaData: state.quotaData,
});

export function mainMenuShortcutState(config: Config): MainMenuShortcutState {
	return {
		vimEnabled: config.vimEmulation?.enabled ?? false,
		fixJsonUnset: config.fixJson == null,
		diffApplyUnset: config.diffApply == null,
		hasSettings: hasSettingsItems(config),
	};
}

function buildMainMenuShortcutItemsForState({
	vimEnabled,
	fixJsonUnset,
	diffApplyUnset,
	hasSettings,
}: MainMenuShortcutState): ShortcutArray<Value> {
	const items: Keymap<Value> = {
		m: {
			label: "⤭ Switch model",
			value: "model-select",
		},
		a: {
			label: "+ Add a new model",
			value: "add-model",
		},
		c: {
			label: "⦿ New conversation",
			value: "clear-confirm",
		},
	};

	if (vimEnabled) {
		items.e = {
			label: "♺ Switch to Emacs mode",
			value: "vim-toggle",
		};
	} else {
		items.v = {
			label: "♺ Switch to Vim mode",
			value: "vim-toggle",
		};
	}

	if (fixJsonUnset) {
		items.f = {
			label: "🪄 Enable auto-fixing JSON tool calls",
			value: "fix-json-toggle",
		};
	}
	if (diffApplyUnset) {
		items.d = {
			label: "💫 Enable fast diff application",
			value: "diff-apply-toggle",
		};
	}

	items.n = {
		label: "🕭 Notifications",
		value: "notifications-menu",
	};

	if (hasSettings) {
		items.t = {
			label: "⛭ Settings",
			value: "settings-menu",
		};
	}

	items.b = {
		label: "⟵ Back to Octo",
		value: "return",
	};
	items.q = {
		label: "× Quit",
		value: "quit",
	};

	return [{ type: "key", mapping: items }];
}

export function buildMainMenuShortcutItems(
	config: Config,
): ShortcutArray<Value> {
	return buildMainMenuShortcutItemsForState(mainMenuShortcutState(config));
}

export async function handleMainMenuSelection(
	item: Item<Value>,
	{
		config,
		notify,
		onNavigate,
		resetPreMenuVimMode,
		setConfig,
		toggleMenu,
	}: MainMenuSelectContext,
): Promise<void> {
	switch (item.value) {
		case "return":
			toggleMenu();
			return;
		case "quit":
			onNavigate.quitConfirm();
			return;
		case "vim-toggle": {
			const wasEnabled = config.vimEmulation?.enabled ?? false;

			await setConfig({
				...config,
				vimEmulation: { enabled: !wasEnabled },
			});

			if (!wasEnabled) resetPreMenuVimMode();

			notify(`Switched to ${wasEnabled ? "Emacs" : "Vim"} mode`);
			return;
		}
		case "clear-confirm":
			onNavigate.clearConfirm();
			return;
		case "settings-menu":
			onNavigate.settingsMenu();
			return;
		case "model-select":
			onNavigate.modelSelect();
			return;
		case "add-model":
			onNavigate.addModel();
			return;
		case "fix-json-toggle":
			onNavigate.fixJsonToggle();
			return;
		case "diff-apply-toggle":
			onNavigate.diffApplyToggle();
			return;
		case "notifications-menu":
			onNavigate.notificationsMenu();
			return;
		default:
			return;
	}
}

export function MainMenu({ onNavigate }: { onNavigate: MainMenuNavigate }) {
	const { toggleMenu, notify, resetPreMenuVimMode, quotaData } = useAppStore(
		useShallow(mainMenuStateSelector),
	);

	const config = useConfig();
	const setConfig = useSetConfig();
	const configRef = useLatestRef(config);
	const notifyRef = useLatestRef(notify);
	const onNavigateRef = useLatestRef(onNavigate);
	const resetPreMenuVimModeRef = useLatestRef(resetPreMenuVimMode);
	const setConfigRef = useLatestRef(setConfig);
	const toggleMenuRef = useLatestRef(toggleMenu);
	const shortcutState = useMemo(
		() => mainMenuShortcutState(config),
		[
			config.diffApply,
			config.fixJson,
			config.models.length,
			config.vimEmulation?.enabled,
		],
	);
	const { vimEnabled, fixJsonUnset, diffApplyUnset, hasSettings } =
		shortcutState;

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) toggleMenuRef.current();
			},
			[toggleMenuRef],
		),
	);

	const shortcutItems = useMemo(
		() => buildMainMenuShortcutItemsForState(shortcutState),
		// Only these config fields affect the shortcut labels/options.
		// Keep unrelated config churn from rebuilding menu items.
		[vimEnabled, fixJsonUnset, diffApplyUnset, hasSettings],
	);

	const onSelect = useCallback(
		(item: Item<Value>) =>
			handleMainMenuSelection(item, {
				config: configRef.current,
				notify: notifyRef.current,
				onNavigate: onNavigateRef.current,
				resetPreMenuVimMode: resetPreMenuVimModeRef.current,
				setConfig: setConfigRef.current,
				toggleMenu: toggleMenuRef.current,
			}),
		[
			configRef,
			notifyRef,
			onNavigateRef,
			resetPreMenuVimModeRef,
			setConfigRef,
			toggleMenuRef,
		],
	);

	return (
		<KbShortcutPanel
			title="Main Menu"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		>
			<MainMenuQuota config={config} quota={quotaData} />
		</KbShortcutPanel>
	);
}

function MainMenuQuota({
	config,
	quota,
}: {
	config: Config;
	quota: UiState["quotaData"];
}) {
	const model = useSyntheticQuotaModel(config);
	if (!model) return null;
	return <MenuQuotaIndicator config={config} model={model} quota={quota} />;
}

function useSyntheticQuotaModel(config: Config) {
	return useAppStore(
		useCallback(
			(state) => {
				const model = selectModelFromConfig(config, state.modelOverride);
				if (!model) return undefined;
				return providerForBaseUrl(model.baseUrl) === SYNTHETIC_PROVIDER
					? model
					: undefined;
			},
			[config],
		),
	);
}
