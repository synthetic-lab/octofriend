import { useCallback, useMemo } from "react";
import { useLatestInput, useLatestRef } from "../../input/latest_input.ts";
import {
	type Item,
	KbShortcutPanel,
	type Keymap,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import { useConfig } from "../../internal/configuration/react-context.ts";
import type { Config } from "../../internal/configuration/schemas.ts";

export type SettingsValues =
	| "set-default-model"
	| "remove-model"
	| "disable-diff-apply"
	| "disable-fix-json";

const SETTINGS_ITEMS = {
	c: {
		label: "Change the default model",
		value: "set-default-model",
	},
	r: {
		label: "Remove a model",
		value: "remove-model",
	},
	d: {
		label: "Disable fast diff application",
		value: "disable-diff-apply",
	},
	t: {
		label: "Disable auto-fixing JSON tool calls",
		value: "disable-fix-json",
	},
} satisfies Keymap<SettingsValues>;

export function filterSettingsItems(config: Config) {
	const items: Keymap<SettingsValues> = {};
	if (config.models.length > 1) {
		items.c = SETTINGS_ITEMS.c;
		items.r = SETTINGS_ITEMS.r;
	}
	if (config.diffApply) {
		items.d = SETTINGS_ITEMS.d;
	}
	if (config.fixJson) {
		items.t = SETTINGS_ITEMS.t;
	}

	return items;
}

export function hasSettingsItems(config: Config): boolean {
	return (
		config.models.length > 1 ||
		config.diffApply != null ||
		config.fixJson != null
	);
}

export function buildSettingsMenuShortcutItems(
	config: Config,
): ShortcutArray<SettingsValues | "back"> {
	const items: Keymap<SettingsValues | "back"> = filterSettingsItems(config);
	items.b = {
		label: "Back",
		value: "back",
	};
	return [{ type: "key", mapping: items }];
}

export function SettingsMenu({
	onBack,
	onNavigate,
}: {
	onBack: () => void;
	onNavigate: {
		setDefaultModel: () => void;
		removeModel: () => void;
		diffApplyToggle: () => void;
		fixJsonToggle: () => void;
	};
}) {
	const config = useConfig();
	const onBackRef = useLatestRef(onBack);
	const onNavigateRef = useLatestRef(onNavigate);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) onBackRef.current();
			},
			[onBackRef],
		),
	);

	const shortcutItems = useMemo(
		() => buildSettingsMenuShortcutItems(config),
		[config],
	);

	const onSelect = useCallback(
		(item: Item<SettingsValues | "back">) => {
			const navigate = onNavigateRef.current;
			if (item.value === "disable-diff-apply") navigate.diffApplyToggle();
			else if (item.value === "disable-fix-json") navigate.fixJsonToggle();
			else if (item.value === "set-default-model") navigate.setDefaultModel();
			else if (item.value === "remove-model") navigate.removeModel();
			else onBackRef.current();
		},
		[onBackRef, onNavigateRef],
	);

	return (
		<KbShortcutPanel
			title="Settings Menu"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		/>
	);
}
