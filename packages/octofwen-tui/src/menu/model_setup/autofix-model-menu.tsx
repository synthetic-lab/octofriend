import { Box, Text, useInput } from "ink";
import type React from "react";
import { useCallback, useContext, useState } from "react";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";
import { SYNTHETIC_PROVIDER } from "../../internal/model-provider-catalog/main.ts";
import { useModelConnectionTest } from "./add-model-connection.ts";
import { errorContext } from "./add-model-error-context.tsx";
import { CustomAuthFlow, CustomAutofixFlow } from "./add-model-flow.tsx";
import {
	resolveSyntheticAutofixSelection,
	resolveSyntheticAutofixSelectionFromAuth,
	syntheticAutofixDiffApplyFromAuth,
} from "./primitives.tsx";

export type AutofixModelProps = {
	config: Config | null;
	onComplete: (diffApply: Exclude<Config["diffApply"], undefined>) => void;
	onOverrideDefaultApiKey: (apiEnvVar: string) => Promise<void>;
	onCancel: () => void;
	defaultModel: string;
	modelNickname: string;
	children: React.ReactNode;
};
export type AutofixWrapperProps = Omit<
	AutofixModelProps,
	"defaultModel" | "modelNickname" | "children"
>;

export function AutofixModelMenu({
	config,
	onComplete,
	onOverrideDefaultApiKey,
	onCancel,
	defaultModel,
	modelNickname,
	children,
}: AutofixModelProps) {
	const [step, setStep] = useState<"choose" | "custom" | "missing-auth">(
		"choose",
	);
	const [errorMessage, setLocalErrorMessage] = useState("");
	const { setErrorMessage } = useContext(errorContext);
	const modelConnectionTest = useModelConnectionTest();
	const showConnectionError = useCallback(
		(message: string) => {
			setLocalErrorMessage(message);
			setErrorMessage(message);
		},
		[setErrorMessage],
	);

	useInput((_, key) => {
		if (key.escape) onCancel();
	});

	const shortcutItems = [
		{
			type: "key" as const,
			mapping: {
				e: {
					label: `Enable ${modelNickname} via Synthetic (recommended)`,
					value: "synthetic",
				},
				c: {
					label: "Use a custom diff-apply model...",
					value: "custom",
				},
				b: {
					label: "Back",
					value: "back",
				},
			} as const,
		},
	] satisfies ShortcutArray<"synthetic" | "custom" | "back">;

	const onSelect = useCallback(
		async (item: Item<"synthetic" | "custom" | "back">) => {
			setLocalErrorMessage("");
			if (item.value === "synthetic") {
				const result = await resolveSyntheticAutofixSelection({
					config,
					defaultModel,
					modelConnectionTest,
				});
				if (result.step === "missing-auth") {
					setStep("missing-auth");
				} else if (result.step === "connection-failed") {
					showConnectionError(result.errorMessage);
				} else {
					onComplete(result.diffApply);
				}
				return;
			}

			if (item.value === "custom") setStep("custom");
			else onCancel();
		},
		[
			config,
			defaultModel,
			modelConnectionTest,
			onCancel,
			onComplete,
			showConnectionError,
		],
	);

	if (step === "custom") {
		return (
			<CustomAutofixFlow
				config={config}
				onComplete={(model) => {
					const val: Exclude<Config["diffApply"], undefined> = {
						baseUrl: model.baseUrl,
						auth: model.auth,
						model: model.model,
					};
					if (model.auth == null) delete val.auth;
					onComplete(val);
				}}
				onCancel={() => setStep("choose")}
			/>
		);
	}

	if (step === "missing-auth") {
		const syntheticProvider = SYNTHETIC_PROVIDER;
		if (!syntheticProvider) {
			return (
				<Text color="red">
					Synthetic provider is unavailable in the model provider catalog.
				</Text>
			);
		}
		return (
			<CustomAuthFlow
				config={config}
				baseUrl={syntheticProvider.baseUrl}
				onCancel={() => setStep("choose")}
				onComplete={async (auth) => {
					const result = await resolveSyntheticAutofixSelectionFromAuth({
						config,
						defaultModel,
						auth,
						modelConnectionTest,
					});
					if (result.step === "connection-failed") {
						showConnectionError(result.errorMessage);
						setStep("choose");
						return;
					}
					if (result.step === "missing-auth") {
						setStep("missing-auth");
						return;
					}
					if (auth && auth.type === "env") {
						await onOverrideDefaultApiKey(auth.name);
						const diffApply = syntheticAutofixDiffApplyFromAuth(defaultModel);
						if (!diffApply) {
							showConnectionError(
								"Synthetic provider is unavailable in the model provider catalog.",
							);
							setStep("choose");
							return;
						}
						onComplete(diffApply);
					} else {
						onComplete(result.diffApply);
					}
				}}
			/>
		);
	}

	return (
		<KbShortcutPanel
			title={`Enable ${modelNickname} model`}
			shortcutItems={shortcutItems}
			onSelect={onSelect}
		>
			<Box marginBottom={1} flexDirection="column" gap={1}>
				{errorMessage && (
					<Text color="red" bold={true}>
						{errorMessage}
					</Text>
				)}
				{children}
			</Box>
		</KbShortcutPanel>
	);
}
