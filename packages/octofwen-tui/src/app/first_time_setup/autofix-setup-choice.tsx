import { Box, Text } from "ink";
import { useCallback, useRef, useState } from "react";
import { useLatestRef } from "../../input/latest_input.ts";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";
import { SYNTHETIC_PROVIDER } from "../../internal/model-provider-catalog/main.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import type { ModelConnectionTester } from "../../menu/model_setup/add-model-connection.ts";
import { resolveProviderEnvVar } from "../../menu/model_setup/provider-helpers.ts";
import type { ToRoute } from "../../menu/model_setup/setup-router.tsx";
import {
	type ResolveSyntheticAutofixSelectionInput,
	resolveSyntheticAutofixConfig,
} from "../../menu/model_setup/synthetic-autofix.ts";
import { MenuHeader } from "../../menu/root.tsx";
import type { AutofixConfig, AutofixSetupRouteData } from "./types.ts";

const AUTOFIX_SETUP_SHORTCUT_ITEMS = [
	{
		type: "key" as const,
		mapping: {
			e: {
				label: "💫 Enable autofix models via Synthetic (recommended)",
				value: "synthetic",
			},
			c: {
				label: "Use custom models...",
				value: "custom",
			},
			s: {
				label: "Skip for now (can be enabled later)",
				value: "skip",
			},
		} as const,
	},
] satisfies ShortcutArray<"synthetic" | "custom" | "skip">;

export function AutofixSetupChooseRoute({
	errorMessage,
	config,
	modelConnectionTest,
	onComplete,
	onSkip,
	to,
	env,
	readKeyForModel,
}: AutofixSetupRouteData["choose"] & {
	config: Config | null;
	modelConnectionTest: ModelConnectionTester;
	onComplete: (config: AutofixConfig) => void;
	onSkip: () => void;
	to: ToRoute<AutofixSetupRouteData>;
	env?: Record<string, string | undefined>;
	readKeyForModel?: ResolveSyntheticAutofixSelectionInput["readKeyForModel"];
}) {
	const [checkingSynthetic, setCheckingSynthetic] = useState(false);
	const checkingSyntheticRef = useRef(false);
	const configRef = useLatestRef(config);
	const modelConnectionTestRef = useLatestRef(modelConnectionTest);
	const onCompleteRef = useLatestRef(onComplete);
	const onSkipRef = useLatestRef(onSkip);
	const toRef = useLatestRef(to);
	const envRef = useLatestRef(env);
	const readKeyForModelRef = useLatestRef(readKeyForModel);
	const syntheticEnvVar = SYNTHETIC_PROVIDER
		? resolveProviderEnvVar(SYNTHETIC_PROVIDER, config, null)
		: "SYNTHETIC_API_KEY";
	const chooseSynthetic = useCallback(async () => {
		if (checkingSyntheticRef.current) return;
		checkingSyntheticRef.current = true;
		setCheckingSynthetic(true);
		const result = await resolveSyntheticAutofixConfig({
			config: configRef.current,
			modelConnectionTest: modelConnectionTestRef.current,
			env: envRef.current,
			readKeyForModel: readKeyForModelRef.current,
		});
		if (result.step === "complete") {
			onCompleteRef.current(result.config);
			return;
		}
		if (result.step === "connection-failed") {
			checkingSyntheticRef.current = false;
			setCheckingSynthetic(false);
			toRef.current.choose({ errorMessage: result.errorMessage });
			return;
		}
		toRef.current.syntheticSetup({});
	}, []);

	const onSelect = useCallback(
		async (item: Item<"synthetic" | "custom" | "skip">) => {
			if (checkingSyntheticRef.current) return;
			if (item.value === "custom") {
				toRef.current.diffApplyCustom({});
				return;
			}
			if (item.value === "skip") {
				onSkipRef.current();
				return;
			}
			await chooseSynthetic();
		},
		[chooseSynthetic],
	);

	if (checkingSynthetic) {
		return (
			<CenteredBox>
				<MenuHeader title="Checking Synthetic autofix models..." />
			</CenteredBox>
		);
	}

	return (
		<KbShortcutPanel
			title="Optional: Enable autofix models"
			shortcutItems={AUTOFIX_SETUP_SHORTCUT_ITEMS}
			onSelect={onSelect}
		>
			<Box marginBottom={1} flexDirection="column" gap={1}>
				{errorMessage && (
					<Text color="red" bold={true}>
						{errorMessage}
					</Text>
				)}
				<Text>
					Before we set up your main coding model, we can optionally enable two
					small helper models that can significantly improve Octo's performance.
					These are small, fast models trained to auto-fix broken tool calls and
					diff edits from your main coding model, since even fairly good coding
					models can sometimes make mistakes.
				</Text>
				<Text>
					Auto-fixing mistakes can help reduce model confusion, since models are
					often less-well-trained on error recovery than they are at their happy
					paths.
				</Text>
				<Text color="gray">
					If {syntheticEnvVar} is already set, Octo will test it first. If not,
					you can enter a Synthetic API key, use another environment variable,
					or use a secret command.
				</Text>
			</Box>
		</KbShortcutPanel>
	);
}
