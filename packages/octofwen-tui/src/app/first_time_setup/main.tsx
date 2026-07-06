import { useApp } from "ink";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Config } from "../../internal/configuration/schemas.ts";
import {
	keyFromName,
	SYNTHETIC_PROVIDER,
} from "../../internal/model-provider-catalog/main.ts";
import type { ModelConnectionTester } from "../../menu/model_setup/add-model-connection.ts";
import { ModelConnectionTestContext } from "../../menu/model_setup/add-model-connection.ts";
import { ModelSetup } from "../../menu/model_setup/auto-detect-models.tsx";
import { Back, router } from "../../menu/model_setup/primitives.tsx";
import { AutofixCompleteScreen } from "./autofix-complete-screen.tsx";
import { AutofixSetup } from "./autofix-setup.tsx";
import { NameStep } from "./name-step.tsx";
import type { FirstTimeSetupRouteData } from "./types.ts";
import { WelcomeScreen } from "./welcome-screen.tsx";

export const firstTimeSetupFlow = router<FirstTimeSetupRouteData>();

function DoneRoute() {
	const app = useApp();
	useLayoutEffect(() => {
		app.exit();
	}, [app]);
	return null;
}

export function FirstTimeSetup({
	configPath,
	modelConnectionTest,
}: {
	configPath: string;
	modelConnectionTest: ModelConnectionTester;
}) {
	const [defaultApiKeyOverrides, setDefaultApiKeyOverrides] = useState<
		Record<string, string>
	>({});
	const defaultApiKeyOverridesRef = useRef(defaultApiKeyOverrides);
	defaultApiKeyOverridesRef.current = defaultApiKeyOverrides;

	const addOverride = useCallback(async (override: Record<string, string>) => {
		await Promise.resolve();
		setDefaultApiKeyOverrides((current) => ({
			...current,
			...override,
		}));
	}, []);

	const routes = useMemo(
		() =>
			firstTimeSetupFlow.route({
				welcome: (to) => () => (
					<WelcomeScreen onContinue={() => to.autofixSetup({})} />
				),
				autofixSetup: (to) => () => (
					<ModelConnectionTestContext.Provider value={modelConnectionTest}>
						<AutofixSetup
							onComplete={(autofixConfig) =>
								to.autofixComplete({ autofixConfig })
							}
							onSkip={() => to.addModel({})}
							onOverrideDefaultApiKey={async (envVar) => {
								const key = keyFromName(SYNTHETIC_PROVIDER.name);
								if (key.success) {
									await addOverride({
										[key.data]: envVar,
									});
								}
							}}
						/>
					</ModelConnectionTestContext.Provider>
				),
				autofixComplete: (to) => (props) => (
					<Back go={() => to.autofixSetup({})}>
						<AutofixCompleteScreen
							onContinue={() =>
								to.addModel({ autofixConfig: props.autofixConfig })
							}
						/>
					</Back>
				),
				addModel: (to) => (props) => (
					<ModelConnectionTestContext.Provider value={modelConnectionTest}>
						<ModelSetup
							config={null}
							onComplete={(models: Config["models"]) =>
								to.name({ models, autofixConfig: props.autofixConfig })
							}
							onCancel={() => {
								if (props.autofixConfig) {
									to.autofixComplete({ autofixConfig: props.autofixConfig });
									return;
								}
								to.welcome({});
							}}
							onOverrideDefaultApiKey={addOverride}
							titleOverride={
								props.autofixConfig
									? undefined
									: "Okay, we'll skip that for now. Let's set you up with a coding model. Which inference provider do you want to use?"
							}
						/>
					</ModelConnectionTestContext.Provider>
				),
				name: (to) => (props) => (
					<NameStep
						configPath={configPath}
						models={props.models}
						autofixConfig={props.autofixConfig}
						defaultApiKeyOverrides={defaultApiKeyOverridesRef.current}
						onDone={() => to.done({})}
					/>
				),
				done: () => DoneRoute,
			}),
		[addOverride, configPath, modelConnectionTest],
	);

	return <routes.Root route="welcome" props={{}} />;
}
