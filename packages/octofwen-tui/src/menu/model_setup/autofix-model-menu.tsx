import { Box, useInput } from "ink";
import type React from "react";
import { useCallback, useState } from "react";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";
import { SYNTHETIC_PROVIDER } from "../../internal/model-provider-catalog/main.ts";
import { CustomAuthFlow, CustomAutofixFlow } from "./add-model-flow.tsx";
import {
	resolveSyntheticAutofixSelection,
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
			if (item.value === "synthetic") {
				const result = await resolveSyntheticAutofixSelection({
					config,
					defaultModel,
				});
				if (result.step === "missing-auth") {
					setStep("missing-auth");
				} else {
					onComplete(result.diffApply);
				}
				return;
			}

			if (item.value === "custom") setStep("custom");
			else onCancel();
		},
		[config, onCancel, onComplete],
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
		return (
			<CustomAuthFlow
				config={config}
				baseUrl={SYNTHETIC_PROVIDER.baseUrl}
				onCancel={() => setStep("choose")}
				onComplete={async (auth) => {
					if (auth && auth.type === "env") {
						await onOverrideDefaultApiKey(auth.name);
						onComplete(syntheticAutofixDiffApplyFromAuth(defaultModel));
					} else {
						onComplete(syntheticAutofixDiffApplyFromAuth(defaultModel, auth));
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
				{children}
			</Box>
		</KbShortcutPanel>
	);
}
