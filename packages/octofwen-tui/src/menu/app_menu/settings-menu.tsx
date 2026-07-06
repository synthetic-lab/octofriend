import { useInput } from "ink";
import { useCallback } from "react";
import {
	type Item,
	KbShortcutPanel,
	type Keymap,
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
	let items: Keymap<SettingsValues> = {};
	if (config.models.length > 1) {
		items = {
			...items,
			c: SETTINGS_ITEMS.c,
			r: SETTINGS_ITEMS.r,
		};
	}
	if (config.diffApply) {
		items = {
			...items,
			d: SETTINGS_ITEMS.d,
		};
	}
	if (config.fixJson) {
		items = {
			...items,
			t: SETTINGS_ITEMS.t,
		};
	}

	return items;
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

	useInput((_, key) => {
		if (key.escape) onBack();
	});

	const settingsItems = filterSettingsItems(config);
	const items: Keymap<SettingsValues | "back"> = {
		...settingsItems,
		b: {
			label: "Back",
			value: "back" as const,
		},
	};

	const onSelect = useCallback(
		(item: Item<SettingsValues | "back">) => {
			if (item.value === "disable-diff-apply") onNavigate.diffApplyToggle();
			else if (item.value === "disable-fix-json") onNavigate.fixJsonToggle();
			else if (item.value === "set-default-model") onNavigate.setDefaultModel();
			else if (item.value === "remove-model") onNavigate.removeModel();
			else onBack();
		},
		[onBack, onNavigate],
	);

	return (
		<KbShortcutPanel
			title="Settings Menu"
			shortcutItems={[{ type: "key" as const, mapping: items }]}
			onSelect={onSelect}
		/>
	);
}
