import { Box, Text } from "ink";
import { useCallback, useState } from "react";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";
import { SYNTHETIC_PROVIDER } from "../../internal/model-provider-catalog/main.ts";
import { CustomAuthFlow } from "../../menu/model_setup/add-model-flow.tsx";
import { AutofixModelMenu } from "../../menu/model_setup/autofix-model-menu.tsx";
import type { AutofixConfig } from "./types.ts";

type AutofixStates =
	| "choose"
	| "synthetic-setup"
	| "diff-apply-custom"
	| "fix-json-custom";

export function AutofixSetup({
	onComplete,
	onSkip,
	onOverrideDefaultApiKey,
}: {
	onComplete: (config: AutofixConfig) => void;
	onSkip: () => void;
	onOverrideDefaultApiKey: (envVar: string) => Promise<void>;
}) {
	const [autofixStep, setAutofixStep] = useState<AutofixStates>("choose");
	const [diffApplyConfig, setDiffApplyConfig] = useState<Config["diffApply"]>();

	const shortcutItems = [
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

	const onSelect = useCallback(
		(item: Item<"synthetic" | "custom" | "skip">) => {
			if (item.value === "synthetic") {
				const defaultEnvVar = SYNTHETIC_PROVIDER.envVar;
				if (process.env[defaultEnvVar]) {
					onComplete({
						diffApply: {
							baseUrl: SYNTHETIC_PROVIDER.baseUrl,
							model: "hf:syntheticlab/diff-apply",
						},
						fixJson: {
							baseUrl: SYNTHETIC_PROVIDER.baseUrl,
							model: "hf:syntheticlab/fix-json",
						},
					});
				} else {
					setAutofixStep("synthetic-setup");
				}
			} else if (item.value === "custom") {
				setAutofixStep("diff-apply-custom");
			} else {
				onSkip();
			}
		},
		[onComplete, onSkip],
	);

	if (autofixStep === "synthetic-setup") {
		return (
			<CustomAuthFlow
				config={null}
				onComplete={async (auth) => {
					if (auth && auth.type === "env")
						await onOverrideDefaultApiKey(auth.name);
					const authField = auth ? { auth } : {};
					onComplete({
						diffApply: {
							baseUrl: SYNTHETIC_PROVIDER.baseUrl,
							model: "hf:syntheticlab/diff-apply",
							...authField,
						},
						fixJson: {
							baseUrl: SYNTHETIC_PROVIDER.baseUrl,
							model: "hf:syntheticlab/fix-json",
							...authField,
						},
					});
				}}
				onCancel={() => setAutofixStep("choose")}
				baseUrl={SYNTHETIC_PROVIDER.baseUrl}
			/>
		);
	}

	if (autofixStep === "diff-apply-custom") {
		return (
			<AutofixModelMenu
				key="diff-apply-custom"
				config={null}
				defaultModel="hf:syntheticlab/diff-apply"
				modelNickname="diff-apply"
				onOverrideDefaultApiKey={onOverrideDefaultApiKey}
				onComplete={(config) => {
					setDiffApplyConfig(config);
					setAutofixStep("fix-json-custom");
				}}
				onCancel={() => setAutofixStep("choose")}
			>
				<Text>
					Even good coding models sometimes make minor mistakes generating code
					diffs, which can cause slow retries and can confuse them, since models
					often aren't trained as well to handle edit failures as they are
					successes. Diff-apply is a fast, small model that fixes minor code
					diff edit inaccuracies. It speeds up iteration and can significantly
					improve model performance.
				</Text>
			</AutofixModelMenu>
		);
	}

	if (autofixStep === "fix-json-custom") {
		return (
			<AutofixModelMenu
				key="fix-json-custom"
				config={null}
				defaultModel="hf:syntheticlab/fix-json"
				modelNickname="fix-json"
				onOverrideDefaultApiKey={onOverrideDefaultApiKey}
				onComplete={(config) => {
					if (!diffApplyConfig) {
						throw new Error(
							"diff-apply model must be configured before fix-json setup",
						);
					}
					onComplete({
						diffApply: diffApplyConfig,
						fixJson: config,
					});
				}}
				onCancel={() => setAutofixStep("diff-apply-custom")}
			>
				<Text>
					Octo uses tools to work with your underlying codebase. Some model
					providers don't support strict constraints on how tool calls are
					generated, and models can make mistakes generating JSON, the format
					used for all of Octo's tool calls.
				</Text>
				<Text>
					The fix-json model can automatically fix broken JSON for Octo, helping
					models avoid failures more quickly and cheaply than retrying the main
					model. It also may help reduce the main model's confusion.
				</Text>
			</AutofixModelMenu>
		);
	}

	return (
		<KbShortcutPanel
			title="Optional: Enable autofix models"
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		>
			<Box marginBottom={1} flexDirection="column" gap={1}>
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
			</Box>
		</KbShortcutPanel>
	);
}
