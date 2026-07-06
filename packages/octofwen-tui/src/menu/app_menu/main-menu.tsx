import { useInput } from "ink";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useModel } from "../../app/state/model-hook.ts";
import { useAppStore } from "../../app/state/store.ts";
import {
	type Item,
	KbShortcutPanel,
	type Keymap,
} from "../../input/shortcuts.tsx";
import {
	useConfig,
	useSetConfig,
} from "../../internal/configuration/react-context.ts";
import {
	providerForBaseUrl,
	SYNTHETIC_PROVIDER,
} from "../../internal/model-provider-catalog/main.ts";
import { MenuQuotaIndicator } from "../quota.tsx";
import { filterSettingsItems } from "./settings-menu.tsx";

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

export function MainMenu({ onNavigate }: { onNavigate: MainMenuNavigate }) {
	const { toggleMenu, notify, resetPreMenuVimMode, quotaData } = useAppStore(
		useShallow((state) => ({
			toggleMenu: state.toggleMenu,
			notify: state.notify,
			resetPreMenuVimMode: state.resetPreMenuVimMode,
			quotaData: state.quotaData,
		})),
	);

	const config = useConfig();
	const setConfig = useSetConfig();
	const model = useModel();
	const provider = providerForBaseUrl(model.baseUrl);
	const isSynthetic = provider === SYNTHETIC_PROVIDER;

	useInput((_, key) => {
		if (key.escape) toggleMenu();
	});

	let items: Keymap<Value> = {
		m: {
			label: "⤭ Switch model",
			value: "model-select" as const,
		},
		a: {
			label: "+ Add a new model",
			value: "add-model" as const,
		},
		c: {
			label: "⦿ New conversation",
			value: "clear-confirm" as const,
		},
	};

	if (config.vimEmulation?.enabled) {
		items = {
			...items,
			e: {
				label: "♺ Switch to Emacs mode",
				value: "vim-toggle" as const,
			},
		};
	} else {
		items = {
			...items,
			v: {
				label: "♺ Switch to Vim mode",
				value: "vim-toggle" as const,
			},
		};
	}

	if (config.fixJson == null) {
		items = {
			...items,
			f: {
				label: "🪄 Enable auto-fixing JSON tool calls",
				value: "fix-json-toggle" as const,
			},
		};
	}
	if (config.diffApply == null) {
		items = {
			...items,
			d: {
				label: "💫 Enable fast diff application",
				value: "diff-apply-toggle" as const,
			},
		};
	}

	items = {
		...items,
		n: {
			label: "🕭 Notifications",
			value: "notifications-menu" as const,
		},
	};

	const settings = filterSettingsItems(config);
	if (Object.values(settings).length > 0) {
		items = {
			...items,
			t: {
				label: "⛭ Settings",
				value: "settings-menu" as const,
			},
		};
	}

	items = {
		...items,
		b: {
			label: "⟵ Back to Octo",
			value: "return" as const,
		},
		q: {
			label: "× Quit",
			value: "quit" as const,
		},
	};

	const onSelect = useCallback(
		async (item: Item<Value>) => {
			switch (item.value) {
				case "return":
					toggleMenu();
					return;
				case "quit":
					onNavigate.quitConfirm();
					return;
				case "vim-toggle": {
					const wasEnabled = config.vimEmulation?.["enabled"] ?? false;

					// Write ONLY to config - single source of truth
					await setConfig({
						...config,
						vimEmulation: { enabled: !wasEnabled },
					});

					// When switching from Emacs to Vim, default to INSERT mode
					if (!wasEnabled) {
						resetPreMenuVimMode();
					}

					// Notify user
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
		},
		[config, notify, onNavigate, resetPreMenuVimMode, setConfig, toggleMenu],
	);

	return (
		<KbShortcutPanel
			title="Main Menu"
			shortcutItems={[{ type: "key" as const, mapping: items }]}
			onSelect={onSelect}
		>
			{isSynthetic ? (
				<MenuQuotaIndicator config={config} model={model} quota={quotaData} />
			) : null}
		</KbShortcutPanel>
	);
}
