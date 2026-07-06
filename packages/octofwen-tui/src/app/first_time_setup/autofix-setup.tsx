import { Box, Text } from "ink";
import { useMemo } from "react";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import type { Auth } from "../../internal/configuration/schemas.ts";
import { SYNTHETIC_PROVIDER } from "../../internal/model-provider-catalog/main.ts";
import { useModelConnectionTest } from "../../menu/model_setup/add-model-connection.ts";
import { CustomAuthFlow } from "../../menu/model_setup/add-model-flow.tsx";
import { AutofixModelMenu } from "../../menu/model_setup/autofix-model-menu.tsx";
import {
	Back,
	resolveSyntheticAutofixConfig,
	resolveSyntheticAutofixConfigFromAuth,
	router,
} from "../../menu/model_setup/primitives.tsx";
import type { AutofixConfig, AutofixSetupRouteData } from "./types.ts";

export const autofixSetupFlow = router<AutofixSetupRouteData>();

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

export function AutofixSetup({
	onComplete,
	onSkip,
	onOverrideDefaultApiKey,
}: {
	onComplete: (config: AutofixConfig) => void;
	onSkip: () => void;
	onOverrideDefaultApiKey: (envVar: string) => Promise<void>;
}) {
	const modelConnectionTest = useModelConnectionTest();

	const routes = useMemo(
		() =>
			autofixSetupFlow.route({
				choose: (to) => {
					const chooseSynthetic = async () => {
						const result = await resolveSyntheticAutofixConfig({
							config: null,
							modelConnectionTest,
						});
						if (result.step === "complete") {
							onComplete(result.config);
							return;
						}
						if (result.step === "connection-failed") {
							to.choose({ errorMessage: result.errorMessage });
							return;
						}
						to.syntheticSetup({});
					};

					const onSelect = async (
						item: Item<"synthetic" | "custom" | "skip">,
					) => {
						if (item.value === "custom") {
							to.diffApplyCustom({});
							return;
						}
						if (item.value === "skip") {
							onSkip();
							return;
						}
						await chooseSynthetic();
					};

					return (props) => (
						<KbShortcutPanel
							title="Optional: Enable autofix models"
							shortcutItems={AUTOFIX_SETUP_SHORTCUT_ITEMS}
							onSelect={onSelect}
						>
							<Box marginBottom={1} flexDirection="column" gap={1}>
								{props.errorMessage && (
									<Text color="red" bold={true}>
										{props.errorMessage}
									</Text>
								)}
								<Text>
									Before we set up your main coding model, we can optionally
									enable two small helper models that can significantly improve
									Octo's performance. These are small, fast models trained to
									auto-fix broken tool calls and diff edits from your main
									coding model, since even fairly good coding models can
									sometimes make mistakes.
								</Text>
								<Text>
									Auto-fixing mistakes can help reduce model confusion, since
									models are often less-well-trained on error recovery than they
									are at their happy paths.
								</Text>
							</Box>
						</KbShortcutPanel>
					);
				},
				syntheticSetup: (to) => () => {
					const syntheticProvider = SYNTHETIC_PROVIDER;
					if (!syntheticProvider) {
						return (
							<Back go={() => to.choose({})}>
								<Text color="red">
									Synthetic provider is unavailable in the model provider
									catalog.
								</Text>
							</Back>
						);
					}
					const applyEnvOverride = async (auth: Auth | undefined) => {
						if (auth?.type === "env") await onOverrideDefaultApiKey(auth.name);
					};

					const onSyntheticAuthComplete = async (auth: Auth | undefined) => {
						const result = await resolveSyntheticAutofixConfigFromAuth({
							config: null,
							auth,
							modelConnectionTest,
						});
						if (result.step === "connection-failed") {
							to.choose({ errorMessage: result.errorMessage });
							return;
						}
						if (result.step === "missing-auth") {
							to.syntheticSetup({});
							return;
						}
						await applyEnvOverride(auth);
						onComplete(result.config);
					};

					return (
						<Back go={() => to.choose({})}>
							<CustomAuthFlow
								config={null}
								onComplete={onSyntheticAuthComplete}
								onCancel={() => to.choose({})}
								baseUrl={syntheticProvider.baseUrl}
							/>
						</Back>
					);
				},
				diffApplyCustom: (to) => () => (
					<AutofixModelMenu
						key="diff-apply-custom"
						config={null}
						defaultModel="hf:syntheticlab/diff-apply"
						modelNickname="diff-apply"
						onOverrideDefaultApiKey={onOverrideDefaultApiKey}
						onComplete={(config) => {
							to.fixJsonCustom({ diffApplyConfig: config });
						}}
						onCancel={() => to.choose({})}
					>
						<Text>
							Even good coding models sometimes make minor mistakes generating
							code diffs, which can cause slow retries and can confuse them,
							since models often aren't trained as well to handle edit failures
							as they are successes. Diff-apply is a fast, small model that
							fixes minor code diff edit inaccuracies. It speeds up iteration
							and can significantly improve model performance.
						</Text>
					</AutofixModelMenu>
				),
				fixJsonCustom: (to) => (props) => (
					<AutofixModelMenu
						key="fix-json-custom"
						config={null}
						defaultModel="hf:syntheticlab/fix-json"
						modelNickname="fix-json"
						onOverrideDefaultApiKey={onOverrideDefaultApiKey}
						onComplete={(config) => {
							onComplete({
								diffApply: props.diffApplyConfig,
								fixJson: config,
							});
						}}
						onCancel={() => to.diffApplyCustom({})}
					>
						<Text>
							Octo uses tools to work with your underlying codebase. Some model
							providers don't support strict constraints on how tool calls are
							generated, and models can make mistakes generating JSON, the
							format used for all of Octo's tool calls.
						</Text>
						<Text>
							The fix-json model can automatically fix broken JSON for Octo,
							helping models avoid failures more quickly and cheaply than
							retrying the main model. It also may help reduce the main model's
							confusion.
						</Text>
					</AutofixModelMenu>
				),
			}),
		[modelConnectionTest, onComplete, onOverrideDefaultApiKey, onSkip],
	);

	return <routes.Root route="choose" props={{}} />;
}
