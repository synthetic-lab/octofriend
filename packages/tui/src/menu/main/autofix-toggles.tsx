import { Text } from "ink";
import type React from "react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../shell/state/store";
import type { UiState } from "../../shell/state/types";
import { useLatestInput, useLatestRef } from "../../input/latest-input";
import { ConfirmDialog } from "../../input/shortcuts";
import { mergeDefaultApiKeyOverrides } from "../../runtime/config/api-keys";
import {
	useConfig,
	useSetConfig,
} from "../../runtime/config/react-context";
import type { Config } from "../../runtime/config/schemas";
import {
	keyFromName,
	SYNTHETIC_PROVIDER,
} from "../../runtime/models/catalog/main";
import { AutofixModelMenu } from "../models/autofix-menu";

const autofixToggleStateSelector = (state: UiState) => ({
	toggleMenu: state.toggleMenu,
	notify: state.notify,
});

export function mergeAutofixCompletionConfig<K extends "diffApply" | "fixJson">(
	config: Config,
	configKey: K,
	setting: NonNullable<Config[K]>,
): Config {
	let defaultApiKeyOverrides = config.defaultApiKeyOverrides;
	if (setting.auth?.type === "env" && SYNTHETIC_PROVIDER) {
		const key = keyFromName(SYNTHETIC_PROVIDER.name);
		if (key.success) {
			defaultApiKeyOverrides = mergeDefaultApiKeyOverrides(
				defaultApiKeyOverrides,
				{ [key.data]: setting.auth.name },
			);
		}
	}
	return {
		...config,
		defaultApiKeyOverrides,
		[configKey]: setting,
	};
}

function AutofixToggle({
	configKey,
	modelNickname,
	disableNotification,
	enableNotification,
	defaultModel,
	children,
	onBack,
}: {
	disableNotification: string;
	enableNotification: string;
	defaultModel: string;
	modelNickname: string;
	configKey: "diffApply" | "fixJson";
	children: React.ReactNode;
	onBack: () => void;
}) {
	const config = useConfig();
	const setConfig = useSetConfig();
	const { toggleMenu, notify } = useAppStore(
		useShallow(autofixToggleStateSelector),
	);
	const configRef = useLatestRef(config);
	const setConfigRef = useLatestRef(setConfig);
	const toggleMenuRef = useLatestRef(toggleMenu);
	const notifyRef = useLatestRef(notify);
	const onBackRef = useLatestRef(onBack);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) onBackRef.current();
			},
			[onBackRef],
		),
	);

	const handleReject = useCallback(async () => {
		const config = configRef.current;
		const newconf = { ...config };
		delete newconf[configKey];
		await setConfigRef.current(newconf);
		toggleMenuRef.current();
		notifyRef.current(disableNotification);
	}, [
		configKey,
		configRef,
		disableNotification,
		notifyRef,
		setConfigRef,
		toggleMenuRef,
	]);

	const handleConfirm = useCallback(() => {
		onBackRef.current();
	}, [onBackRef]);

	const handleOverrideDefaultApiKey = useCallback(
		async (apiEnvVar: string) => {
			if (!SYNTHETIC_PROVIDER) return;
			const key = keyFromName(SYNTHETIC_PROVIDER.name);
			if (!key.success) return;
			const config = configRef.current;
			const defaultApiKeyOverrides = mergeDefaultApiKeyOverrides(
				config.defaultApiKeyOverrides,
				{ [key.data]: apiEnvVar },
			);
			if (defaultApiKeyOverrides === config.defaultApiKeyOverrides) return;
			await setConfigRef.current({
				...config,
				defaultApiKeyOverrides,
			});
		},
		[configRef, setConfigRef],
	);

	const handleComplete = useCallback(
		async (setting: NonNullable<(typeof config)[typeof configKey]>) => {
			await setConfigRef.current(
				mergeAutofixCompletionConfig(configRef.current, configKey, setting),
			);
			toggleMenuRef.current();
			notifyRef.current(enableNotification);
		},
		[
			configKey,
			configRef,
			enableNotification,
			notifyRef,
			setConfigRef,
			toggleMenuRef,
		],
	);

	if (config[configKey]) {
		return (
			<ConfirmDialog
				rejectLabel={`Disable ${modelNickname}`}
				confirmLabel={`Keep ${modelNickname} on (recommended)`}
				onReject={handleReject}
				onConfirm={handleConfirm}
			/>
		);
	}
	return (
		<AutofixModelMenu
			defaultModel={defaultModel}
			modelNickname={modelNickname}
			config={config}
			onOverrideDefaultApiKey={handleOverrideDefaultApiKey}
			onComplete={handleComplete}
			onCancel={handleConfirm}
		>
			{children}
		</AutofixModelMenu>
	);
}

export function DiffApplyToggle({ onBack }: { onBack: () => void }) {
	return (
		<AutofixToggle
			defaultModel="hf:syntheticlab/diff-apply"
			configKey="diffApply"
			modelNickname="diff-apply"
			enableNotification="Fast diff apply enabled"
			disableNotification="Fast diff apply disabled"
			onBack={onBack}
		>
			<Text>
				Even good coding models sometimes make minor mistakes generating code
				diffs, which can cause slow retries and can confuse them, since models
				often aren't trained as well to handle edit failures as they are
				successes. Diff-apply is a fast, small model that fixes minor code diff
				edit inaccuracies. It speeds up iteration and can significantly improve
				model performance.
			</Text>
		</AutofixToggle>
	);
}

export function FixJsonToggle({ onBack }: { onBack: () => void }) {
	return (
		<AutofixToggle
			defaultModel="hf:syntheticlab/fix-json"
			configKey="fixJson"
			modelNickname="fix-json"
			enableNotification="JSON auto-fix enabled"
			disableNotification="JSON auto-fix disabled"
			onBack={onBack}
		>
			<Text>
				Octo uses tools to work with your underlying codebase. Some model
				providers don't support strict constraints on how tool calls are
				generated, and models can make mistakes generating JSON, the format used
				for all of Octo's tool calls.
			</Text>
			<Text>
				The fix-json model can automatically fix broken JSON for Octo, helping
				models avoid failures more quickly and cheaply than retrying the main
				model. It also may help reduce the main model's confusion.
			</Text>
		</AutofixToggle>
	);
}
