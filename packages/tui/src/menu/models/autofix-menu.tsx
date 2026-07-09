import { Box, Text } from "ink";
import type React from "react";
import { useCallback, useContext, useMemo, useRef, useState } from "react";
import { useLatestInput, useLatestRef } from "../../input/latest-input";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts";
import type { Config } from "../../runtime/config/schemas";
import { useModelConnectionTest } from "./connection";
import { errorContext } from "./error-context";
import { CustomAutofixFlow } from "./flow";
import { CustomAuthFlow } from "./custom-auth";
import {
	resolveSyntheticAutofixSelection,
	resolveSyntheticAutofixSelectionFromAuth,
	syntheticProviderWithResolvedBaseUrl,
} from "./synthetic-autofix";

export type AutofixModelProps = {
	config: Config | null;
	onComplete: (diffApply: Exclude<Config["diffApply"], undefined>) => void;
	onOverrideDefaultApiKey: (apiEnvVar: string) => Promise<void>;
	onCancel: () => void;
	defaultModel: string;
	modelNickname: string;
	children: React.ReactNode;
	env?: Record<string, string | undefined>;
};
export type AutofixWrapperProps = Omit<
	AutofixModelProps,
	"defaultModel" | "modelNickname" | "children"
>;

type AutofixChoiceValue = "synthetic" | "custom" | "back";

export function buildAutofixShortcutItems(
	modelNickname: string,
): ShortcutArray<AutofixChoiceValue> {
	return [
		{
			type: "key",
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
			},
		},
	];
}

export function AutofixModelMenu({
	config,
	onComplete,
	onOverrideDefaultApiKey,
	onCancel,
	defaultModel,
	modelNickname,
	children,
	env = process.env,
}: AutofixModelProps) {
	const [step, setStep] = useState<"choose" | "custom" | "missing-auth">(
		"choose",
	);
	const [errorMessage, setLocalErrorMessage] = useState("");
	const [checkingSynthetic, setCheckingSynthetic] = useState(false);
	const checkingSyntheticRef = useRef(false);
	const { setErrorMessage } = useContext(errorContext);
	const modelConnectionTest = useModelConnectionTest();
	const configRef = useLatestRef(config);
	const defaultModelRef = useLatestRef(defaultModel);
	const envRef = useLatestRef(env);
	const modelConnectionTestRef = useLatestRef(modelConnectionTest);
	const onCancelRef = useLatestRef(onCancel);
	const onCompleteRef = useLatestRef(onComplete);
	const onOverrideDefaultApiKeyRef = useLatestRef(onOverrideDefaultApiKey);
	const showConnectionError = useCallback(
		(message: string) => {
			setLocalErrorMessage(message);
			setErrorMessage(message);
		},
		[setErrorMessage],
	);

	const parentInputOptions = useMemo(
		() => ({ isActive: step === "choose" || checkingSynthetic }),
		[checkingSynthetic, step],
	);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) onCancelRef.current();
			},
			[onCancelRef],
		),
		parentInputOptions,
	);

	const shortcutItems = useMemo(
		() => buildAutofixShortcutItems(modelNickname),
		[modelNickname],
	);

	const onSelect = useCallback(
		async (item: Item<AutofixChoiceValue>) => {
			if (checkingSyntheticRef.current) return;
			setLocalErrorMessage("");
			if (item.value === "synthetic") {
				checkingSyntheticRef.current = true;
				setCheckingSynthetic(true);
				const result = await resolveSyntheticAutofixSelection({
					config: configRef.current,
					defaultModel: defaultModelRef.current,
					modelConnectionTest: modelConnectionTestRef.current,
					env: envRef.current,
				});
				if (result.step === "missing-auth") {
					checkingSyntheticRef.current = false;
					setCheckingSynthetic(false);
					setStep("missing-auth");
				} else if (result.step === "connection-failed") {
					checkingSyntheticRef.current = false;
					setCheckingSynthetic(false);
					showConnectionError(result.errorMessage);
				} else {
					onCompleteRef.current(result.diffApply);
				}
				return;
			}

			if (item.value === "custom") setStep("custom");
			else onCancelRef.current();
		},
		[
			configRef,
			defaultModelRef,
			envRef,
			modelConnectionTestRef,
			onCancelRef,
			onCompleteRef,
			showConnectionError,
		],
	);

	const cancelNestedFlow = useCallback(() => {
		setStep("choose");
	}, []);

	const completeCustomAutofix = useCallback(
		(model: Exclude<Config["diffApply"], undefined>) => {
			onCompleteRef.current(
				model.auth == null
					? {
							baseUrl: model.baseUrl,
							model: model.model,
						}
					: {
							baseUrl: model.baseUrl,
							auth: model.auth,
							model: model.model,
						},
			);
		},
		[onCompleteRef],
	);

	const completeMissingAuth = useCallback(
		async (auth?: Exclude<Config["diffApply"], undefined>["auth"]) => {
			const result = await resolveSyntheticAutofixSelectionFromAuth({
				config: configRef.current,
				defaultModel: defaultModelRef.current,
				auth,
				modelConnectionTest: modelConnectionTestRef.current,
				env: envRef.current,
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
				await onOverrideDefaultApiKeyRef.current(auth.name);
			}
			onCompleteRef.current(result.diffApply);
		},
		[
			configRef,
			defaultModelRef,
			envRef,
			modelConnectionTestRef,
			onCompleteRef,
			onOverrideDefaultApiKeyRef,
			showConnectionError,
		],
	);

	if (checkingSynthetic) {
		return (
			<KbShortcutPanel
				title={`Checking ${modelNickname} Synthetic model...`}
				shortcutItems={shortcutItems}
				onSelect={onSelect}
			>
				<Box marginBottom={1} flexDirection="column" gap={1}>
					{children}
				</Box>
			</KbShortcutPanel>
		);
	}

	if (step === "custom") {
		return (
			<CustomAutofixFlow
				config={config}
				onComplete={completeCustomAutofix}
				onCancel={cancelNestedFlow}
			/>
		);
	}

	if (step === "missing-auth") {
		const syntheticProvider = syntheticProviderWithResolvedBaseUrl(env);
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
				provider={syntheticProvider}
				onCancel={cancelNestedFlow}
				onComplete={completeMissingAuth}
				env={env}
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
