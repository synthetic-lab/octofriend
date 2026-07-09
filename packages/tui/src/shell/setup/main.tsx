import { useApp } from "ink";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { type LatestRef, useLatestRef } from "../../input/latest-input";
import { mergeDefaultApiKeyOverrides } from "../../runtime/config/api-keys";
import type { Config } from "../../runtime/config/schemas";
import type { ModelConnectionTester } from "../../menu/models/connection";
import { ModelConnectionTestContext } from "../../menu/models/connection";
import { ModelSetup } from "../../menu/models/detect-models";
import {
	Back,
	router,
	type ToRoute,
} from "../../menu/models/router";
import { AutofixCompleteScreen } from "./autofix-complete";
import { AutofixSetup } from "./autofix";
import { NameStep } from "./name-step";
import type { AutofixConfig, FirstTimeSetupRouteData } from "./types";
import { WelcomeScreen } from "./welcome";

export const firstTimeSetupFlow = router<FirstTimeSetupRouteData>();

const EMPTY_ROUTE_PROPS = {};

const MODEL_SETUP_AFTER_AUTOFIX_TITLE =
	"Autofix is ready. Now choose the coding model provider Octo should use for conversations.";
const MODEL_SETUP_SKIPPED_AUTOFIX_TITLE =
	"Okay, we'll skip autofix for now. Now choose the coding model provider Octo should use for conversations.";

function DoneRoute() {
	const { exit } = useApp();
	useLayoutEffect(() => {
		exit();
	}, [exit]);
	return null;
}

type FirstTimeSetupRefs = {
	configPathRef: LatestRef<string>;
	defaultApiKeyOverridesRef: LatestRef<Record<string, string>>;
	modelConnectionTestRef: LatestRef<ModelConnectionTester>;
	setupConfigRef: LatestRef<Config>;
	envRef: LatestRef<Record<string, string | undefined> | undefined>;
};

function WelcomeRoute({ to }: { to: ToRoute<FirstTimeSetupRouteData> }) {
	const handleContinue = useCallback(() => to.autofixSetup({}), [to]);
	return <WelcomeScreen onContinue={handleContinue} />;
}

function AutofixSetupRoute({
	addOverride,
	modelConnectionTestRef,
	setupConfigRef,
	envRef,
	to,
}: Pick<
	FirstTimeSetupRefs,
	"modelConnectionTestRef" | "setupConfigRef" | "envRef"
> & {
	addOverride: (override: Record<string, string>) => Promise<void>;
	to: ToRoute<FirstTimeSetupRouteData>;
}) {
	const handleComplete = useCallback(
		(autofixConfig: AutofixConfig) => to.autofixComplete({ autofixConfig }),
		[to],
	);
	const handleSkip = useCallback(() => to.addModel({}), [to]);
	const handleOverrideDefaultApiKey = useCallback(
		(override: Record<string, string>) => addOverride(override),
		[addOverride],
	);

	return (
		<ModelConnectionTestContext.Provider value={modelConnectionTestRef.current}>
			<AutofixSetup
				config={setupConfigRef.current}
				onComplete={handleComplete}
				onSkip={handleSkip}
				onOverrideDefaultApiKey={handleOverrideDefaultApiKey}
				env={envRef.current}
			/>
		</ModelConnectionTestContext.Provider>
	);
}

function AutofixCompleteRoute({
	autofixConfig,
	to,
}: FirstTimeSetupRouteData["autofixComplete"] & {
	to: ToRoute<FirstTimeSetupRouteData>;
}) {
	const handleBack = useCallback(() => to.autofixSetup({}), [to]);
	const handleContinue = useCallback(
		() => to.addModel({ autofixConfig }),
		[autofixConfig, to],
	);
	return (
		<Back go={handleBack}>
			<AutofixCompleteScreen onContinue={handleContinue} />
		</Back>
	);
}

function AddModelRoute({
	addOverride,
	autofixConfig,
	modelConnectionTestRef,
	setupConfigRef,
	envRef,
	to,
}: FirstTimeSetupRouteData["addModel"] &
	Pick<
		FirstTimeSetupRefs,
		"modelConnectionTestRef" | "setupConfigRef" | "envRef"
	> & {
		addOverride: (override: Record<string, string>) => Promise<void>;
		to: ToRoute<FirstTimeSetupRouteData>;
	}) {
	const handleComplete = useCallback(
		(models: Config["models"]) => to.name({ models, autofixConfig }),
		[autofixConfig, to],
	);
	const handleCancel = useCallback(() => {
		if (autofixConfig) {
			to.autofixComplete({ autofixConfig });
			return;
		}
		to.welcome({});
	}, [autofixConfig, to]);

	return (
		<ModelConnectionTestContext.Provider value={modelConnectionTestRef.current}>
			<ModelSetup
				config={setupConfigRef.current}
				onComplete={handleComplete}
				onCancel={handleCancel}
				onOverrideDefaultApiKey={addOverride}
				env={envRef.current}
				titleOverride={
					autofixConfig
						? MODEL_SETUP_AFTER_AUTOFIX_TITLE
						: MODEL_SETUP_SKIPPED_AUTOFIX_TITLE
				}
			/>
		</ModelConnectionTestContext.Provider>
	);
}

function NameRoute({
	autofixConfig,
	configPathRef,
	defaultApiKeyOverridesRef,
	models,
	to,
}: FirstTimeSetupRouteData["name"] &
	Pick<FirstTimeSetupRefs, "configPathRef" | "defaultApiKeyOverridesRef"> & {
		to: ToRoute<FirstTimeSetupRouteData>;
	}) {
	const handleBack = useCallback(
		() => to.addModel({ autofixConfig }),
		[autofixConfig, to],
	);
	const handleDone = useCallback(() => to.done({}), [to]);
	return (
		<NameStep
			configPath={configPathRef.current}
			models={models}
			autofixConfig={autofixConfig}
			defaultApiKeyOverrides={defaultApiKeyOverridesRef.current}
			onBack={handleBack}
			onDone={handleDone}
		/>
	);
}

export function FirstTimeSetup({
	configPath,
	modelConnectionTest,
	env,
}: {
	configPath: string;
	modelConnectionTest: ModelConnectionTester;
	env?: Record<string, string | undefined>;
}) {
	const [defaultApiKeyOverrides, setDefaultApiKeyOverrides] = useState<
		Record<string, string>
	>({});
	const configPathRef = useLatestRef(configPath);
	const modelConnectionTestRef = useLatestRef(modelConnectionTest);
	const envRef = useLatestRef(env);
	const defaultApiKeyOverridesRef = useLatestRef(defaultApiKeyOverrides);
	const setupConfig = useMemo<Config>(
		() => ({
			yourName: "",
			models: [],
			defaultApiKeyOverrides,
		}),
		[defaultApiKeyOverrides],
	);
	const setupConfigRef = useLatestRef(setupConfig);

	const addOverride = useCallback(async (override: Record<string, string>) => {
		const current = defaultApiKeyOverridesRef.current;
		const next = mergeDefaultApiKeyOverrides(current, override);
		if (next === current) return;
		defaultApiKeyOverridesRef.current = next;
		setupConfigRef.current = {
			...setupConfigRef.current,
			defaultApiKeyOverrides: next,
		};
		setDefaultApiKeyOverrides(next);
		await Promise.resolve();
	}, []);

	const routes = useMemo(
		() =>
			firstTimeSetupFlow.route({
				welcome: (to) => () => <WelcomeRoute to={to} />,
				autofixSetup: (to) => () => (
					<AutofixSetupRoute
						addOverride={addOverride}
						modelConnectionTestRef={modelConnectionTestRef}
						setupConfigRef={setupConfigRef}
						envRef={envRef}
						to={to}
					/>
				),
				autofixComplete: (to) => (props) => (
					<AutofixCompleteRoute {...props} to={to} />
				),
				addModel: (to) => (props) => (
					<AddModelRoute
						{...props}
						addOverride={addOverride}
						modelConnectionTestRef={modelConnectionTestRef}
						setupConfigRef={setupConfigRef}
						envRef={envRef}
						to={to}
					/>
				),
				name: (to) => (props) => (
					<NameRoute
						{...props}
						configPathRef={configPathRef}
						defaultApiKeyOverridesRef={defaultApiKeyOverridesRef}
						to={to}
					/>
				),
				done: () => DoneRoute,
			}),
		[addOverride],
	);

	return <routes.Root route="welcome" props={EMPTY_ROUTE_PROPS} />;
}
