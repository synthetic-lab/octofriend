import { Text, useInput } from "ink";
import type React from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../app/state/store.ts";
import { ConfirmDialog } from "../../input/shortcuts.tsx";
import {
	useConfig,
	useSetConfig,
} from "../../internal/configuration/react-context.ts";
import {
	keyFromName,
	SYNTHETIC_PROVIDER,
} from "../../internal/model-provider-catalog/main.ts";
import { AutofixModelMenu } from "../model_setup/autofix-model-menu.tsx";
import { useMenuState } from "./menu-state.ts";

function AutofixToggle({
	configKey,
	modelNickname,
	disableNotification,
	enableNotification,
	defaultModel,
	children,
}: {
	disableNotification: string;
	enableNotification: string;
	defaultModel: string;
	modelNickname: string;
	configKey: "diffApply" | "fixJson";
	children: React.ReactNode;
}) {
	const config = useConfig();
	const setConfig = useSetConfig();
	const { setMenuMode } = useMenuState(
		useShallow((state) => ({
			setMenuMode: state.setMenuMode,
		})),
	);
	const { toggleMenu, notify } = useAppStore(
		useShallow((state) => ({
			toggleMenu: state.toggleMenu,
			notify: state.notify,
		})),
	);

	useInput((_, key) => {
		if (key.escape) setMenuMode("main-menu");
	});

	if (config[configKey]) {
		return (
			<ConfirmDialog
				rejectLabel={`Disable ${modelNickname}`}
				confirmLabel={`Keep ${modelNickname} on (recommended)`}
				onReject={async () => {
					const newconf = { ...config };
					delete newconf[configKey];
					await setConfig(newconf);
					setMenuMode("main-menu");
					toggleMenu();
					notify(disableNotification);
				}}
				onConfirm={() => {
					setMenuMode("main-menu");
				}}
			/>
		);
	}
	return (
		<AutofixModelMenu
			defaultModel={defaultModel}
			modelNickname={modelNickname}
			config={config}
			onOverrideDefaultApiKey={async (apiEnvVar) => {
				await setConfig({
					...config,
					defaultApiKeyOverrides: {
						...(config.defaultApiKeyOverrides || {}),
						[keyFromName(SYNTHETIC_PROVIDER.name)]: apiEnvVar,
					},
				});
			}}
			onComplete={async (setting) => {
				await setConfig({
					...config,
					[configKey]: setting,
				});
				setMenuMode("main-menu");
				toggleMenu();
				notify(enableNotification);
			}}
			onCancel={() => {
				setMenuMode("main-menu");
			}}
		>
			{children}
		</AutofixModelMenu>
	);
}

export function DiffApplyToggle() {
	return (
		<AutofixToggle
			defaultModel="hf:syntheticlab/diff-apply"
			configKey="diffApply"
			modelNickname="diff-apply"
			enableNotification="Fast diff apply enabled"
			disableNotification="Fast diff apply disabled"
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

export function FixJsonToggle() {
	return (
		<AutofixToggle
			defaultModel="hf:syntheticlab/fix-json"
			configKey="fixJson"
			modelNickname="fix-json"
			enableNotification="JSON auto-fix enabled"
			disableNotification="JSON auto-fix disabled"
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
