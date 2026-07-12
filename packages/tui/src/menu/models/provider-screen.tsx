import { useCallback, useMemo } from "react";
import { useLatestRef } from "../../input/latest-input.ts";
import { type Item, KbShortcutPanel } from "../../input/shortcuts.tsx";
import type { Config } from "../../runtime/config/schemas.ts";
import type { ProviderKey } from "../../runtime/models/catalog/main.ts";
import { ProviderSetupSummary } from "./auth-summary.tsx";
import {
	buildFastProviderShortcutItems,
	type FastProviderValue,
} from "./provider-select.ts";

export function FastProviderList({
	onChooseCustom,
	onChooseProvider,
	onBack,
	titleOverride,
	config,
	env,
}: {
	onChooseProvider: (provider: ProviderKey) => void;
	onChooseCustom: () => void;
	onBack: () => void;
	titleOverride?: string;
	config?: Pick<Config, "defaultApiKeyOverrides"> | null;
	env?: Record<string, string | undefined>;
}) {
	const shortcutItems = useMemo(
		() => buildFastProviderShortcutItems(undefined, config ?? null),
		[config],
	);
	const onBackRef = useLatestRef(onBack);
	const onChooseCustomRef = useLatestRef(onChooseCustom);
	const onChooseProviderRef = useLatestRef(onChooseProvider);

	const onSelect = useCallback(
		(item: Item<FastProviderValue>) => {
			if (item.value === "custom") return onChooseCustomRef.current();
			if (item.value === "back") return onBackRef.current();
			onChooseProviderRef.current(item.value);
		},
		[onBackRef, onChooseCustomRef, onChooseProviderRef],
	);

	return (
		<KbShortcutPanel
			title={titleOverride || "Choose a model provider:"}
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		>
			<ProviderSetupSummary config={config} env={env} />
		</KbShortcutPanel>
	);
}
