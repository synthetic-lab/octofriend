import { useApp } from "ink";
import { useCallback, useLayoutEffect, useState } from "react";
import type { Config } from "../../internal/configuration/schemas.ts";
import {
	keyFromName,
	SYNTHETIC_PROVIDER,
} from "../../internal/model-provider-catalog/main.ts";
import type { ModelConnectionTester } from "../../menu/model_setup/add-model-connection.ts";
import { ModelConnectionTestContext } from "../../menu/model_setup/add-model-connection.ts";
import { ModelSetup } from "../../menu/model_setup/auto-detect-models.tsx";
import { AutofixCompleteScreen } from "./autofix-complete-screen.tsx";
import { AutofixSetup } from "./autofix-setup.tsx";
import { NameStep } from "./name-step.tsx";
import type { AutofixConfig, SetupStep } from "./types.ts";
import { WelcomeScreen } from "./welcome-screen.tsx";

export function FirstTimeSetup({
	configPath,
	modelConnectionTest,
}: {
	configPath: string;
	modelConnectionTest: ModelConnectionTester;
}) {
	const [step, setStep] = useState<SetupStep>({ step: "welcome" });
	const [defaultApiKeyOverrides, setDefaultApiKeyOverrides] = useState<
		Record<string, string>
	>({});
	const app = useApp();

	const addOverride = useCallback(
		async (override: Record<string, string>) => {
			await Promise.resolve();
			setDefaultApiKeyOverrides({
				...defaultApiKeyOverrides,
				...override,
			});
		},
		[defaultApiKeyOverrides],
	);

	useLayoutEffect(() => {
		if (step.step === "done") app.exit();
	}, [step, app]);

	const handleWelcomeContinue = useCallback(() => {
		setStep({ step: "autofix-setup" });
	}, []);
	const autofixComplete = useCallback((autofixConfig: AutofixConfig) => {
		setStep({ step: "autofix-complete", autofixConfig });
	}, []);
	const autofixSkip = useCallback(() => {
		setStep({ step: "add-model" });
	}, []);
	const autofixCompleteContinue = useCallback(() => {
		if (step.step === "autofix-complete") {
			setStep({ step: "add-model", autofixConfig: step.autofixConfig });
		}
	}, [step]);
	const addModelComplete = useCallback(
		(models: Config["models"]) => {
			if (step.step === "add-model" && step.autofixConfig) {
				setStep({ step: "name", models, autofixConfig: step.autofixConfig });
			} else {
				setStep({ step: "name", models });
			}
		},
		[step],
	);
	const addModelCancel = useCallback(() => {
		if (step.step === "add-model" && step.autofixConfig) {
			setStep({ step: "autofix-complete", autofixConfig: step.autofixConfig });
		} else {
			setStep({ step: "welcome" });
		}
	}, [step]);

	if (step.step === "welcome") {
		return <WelcomeScreen onContinue={handleWelcomeContinue} />;
	}
	if (step.step === "autofix-setup") {
		return (
			<ModelConnectionTestContext.Provider value={modelConnectionTest}>
				<AutofixSetup
					onComplete={autofixComplete}
					onSkip={autofixSkip}
					onOverrideDefaultApiKey={async (envVar) => {
						await addOverride({
							[keyFromName(SYNTHETIC_PROVIDER.name)]: envVar,
						});
					}}
				/>
			</ModelConnectionTestContext.Provider>
		);
	}
	if (step.step === "autofix-complete") {
		return <AutofixCompleteScreen onContinue={autofixCompleteContinue} />;
	}
	if (step.step === "add-model") {
		return (
			<ModelConnectionTestContext.Provider value={modelConnectionTest}>
				<ModelSetup
					config={null}
					onComplete={addModelComplete}
					onCancel={addModelCancel}
					onOverrideDefaultApiKey={addOverride}
					titleOverride={
						step.autofixConfig
							? undefined
							: "Okay, we'll skip that for now. Let's set you up with a coding model. Which inference provider do you want to use?"
					}
				/>
			</ModelConnectionTestContext.Provider>
		);
	}
	if (step.step === "done") return null;

	const _: "name" = step.step;

	return (
		<NameStep
			configPath={configPath}
			models={step.models}
			autofixConfig={step.autofixConfig}
			defaultApiKeyOverrides={defaultApiKeyOverrides}
			onDone={() => setStep({ step: "done" })}
		/>
	);
}
