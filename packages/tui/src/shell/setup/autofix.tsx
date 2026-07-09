import { Text } from "ink";
import { useCallback, useMemo } from "react";
import { useLatestRef } from "../../input/latest-input";
import type { Auth, Config } from "../../runtime/config/schemas";
import {
	type ModelConnectionTester,
	useModelConnectionTest,
} from "../../menu/models/connection";
import { AutofixModelMenu } from "../../menu/models/autofix-menu";
import {
	CustomAuthFlow,
	type ExistingKeyChecker,
} from "../../menu/models/custom-auth";
import { defaultApiKeyOverrideForProviderAuth } from "../../menu/models/auth";
import {
	Back,
	router,
	type ToRoute,
} from "../../menu/models/router";
import {
	type ResolveSyntheticAutofixSelectionInput,
	resolveSyntheticAutofixConfigFromAuth,
	syntheticProviderWithResolvedBaseUrl,
} from "../../menu/models/synthetic-autofix";
import { AutofixSetupChooseRoute } from "./autofix-choice";
import type { AutofixConfig, AutofixSetupRouteData } from "./types";

export const autofixSetupFlow = router<AutofixSetupRouteData>();

const EMPTY_ROUTE_PROPS = {};
type OverrideDefaultApiKey = (
	override: Record<string, string>,
) => Promise<void>;

function AutofixSyntheticSetupRoute({
	config,
	modelConnectionTest,
	onComplete,
	onOverrideDefaultApiKey,
	to,
	env,
	hasExistingKey,
}: {
	config: Config | null;
	modelConnectionTest: ModelConnectionTester;
	onComplete: (config: AutofixConfig) => void;
	onOverrideDefaultApiKey: OverrideDefaultApiKey;
	to: ToRoute<AutofixSetupRouteData>;
	env?: Record<string, string | undefined>;
	hasExistingKey?: ExistingKeyChecker;
}) {
	const syntheticProvider = syntheticProviderWithResolvedBaseUrl(env);
	const goChoose = useCallback(() => {
		to.choose({});
	}, [to]);
	const handleComplete = useCallback(
		async (auth: Auth | undefined) => {
			const result = await resolveSyntheticAutofixConfigFromAuth({
				config,
				auth,
				modelConnectionTest,
				env,
			});
			if (result.step === "connection-failed") {
				to.choose({ errorMessage: result.errorMessage });
				return;
			}
			if (result.step === "missing-auth") {
				to.syntheticSetup({});
				return;
			}
			const defaultOverride = syntheticProvider
				? defaultApiKeyOverrideForProviderAuth(syntheticProvider, auth)
				: null;
			if (defaultOverride) await onOverrideDefaultApiKey(defaultOverride);
			onComplete(result.config);
		},
		[
			config,
			env,
			modelConnectionTest,
			onComplete,
			onOverrideDefaultApiKey,
			syntheticProvider,
			to,
		],
	);

	if (!syntheticProvider) {
		return (
			<Back go={goChoose}>
				<Text color="red">
					Synthetic provider is unavailable in the model provider catalog.
				</Text>
			</Back>
		);
	}

	return (
		<Back go={goChoose}>
			<CustomAuthFlow
				config={config}
				onComplete={handleComplete}
				onCancel={goChoose}
				baseUrl={syntheticProvider.baseUrl}
				provider={syntheticProvider}
				env={env}
				hasExistingKey={hasExistingKey}
			/>
		</Back>
	);
}

function AutofixDiffApplyCustomRoute({
	config,
	onOverrideDefaultApiKey,
	to,
	env,
}: {
	config: Config | null;
	onOverrideDefaultApiKey: (envVar: string) => Promise<void>;
	to: ToRoute<AutofixSetupRouteData>;
	env?: Record<string, string | undefined>;
	readKeyForModel?: ResolveSyntheticAutofixSelectionInput["readKeyForModel"];
	hasExistingKey?: ExistingKeyChecker;
}) {
	const handleComplete = useCallback(
		(config: AutofixSetupRouteData["fixJsonCustom"]["diffApplyConfig"]) => {
			to.fixJsonCustom({ diffApplyConfig: config });
		},
		[to],
	);
	const handleCancel = useCallback(() => {
		to.choose({});
	}, [to]);

	return (
		<AutofixModelMenu
			key="diff-apply-custom"
			config={config}
			defaultModel="hf:syntheticlab/diff-apply"
			modelNickname="diff-apply"
			onOverrideDefaultApiKey={onOverrideDefaultApiKey}
			onComplete={handleComplete}
			onCancel={handleCancel}
			env={env}
		>
			<Text>
				Even good coding models sometimes make minor mistakes generating code
				diffs, which can cause slow retries and can confuse them, since models
				often aren't trained as well to handle edit failures as they are
				successes. Diff-apply is a fast, small model that fixes minor code diff
				edit inaccuracies. It speeds up iteration and can significantly improve
				model performance.
			</Text>
		</AutofixModelMenu>
	);
}

function AutofixFixJsonCustomRoute({
	diffApplyConfig,
	onComplete,
	onOverrideDefaultApiKey,
	to,
	config,
	env,
}: AutofixSetupRouteData["fixJsonCustom"] & {
	onComplete: (config: AutofixConfig) => void;
	config: Config | null;
	onOverrideDefaultApiKey: (envVar: string) => Promise<void>;
	to: ToRoute<AutofixSetupRouteData>;
	env?: Record<string, string | undefined>;
	readKeyForModel?: ResolveSyntheticAutofixSelectionInput["readKeyForModel"];
	hasExistingKey?: ExistingKeyChecker;
}) {
	const handleComplete = useCallback(
		(config: AutofixConfig["fixJson"]) => {
			onComplete({
				diffApply: diffApplyConfig,
				fixJson: config,
			});
		},
		[diffApplyConfig, onComplete],
	);
	const handleCancel = useCallback(() => {
		to.diffApplyCustom({});
	}, [to]);

	return (
		<AutofixModelMenu
			key="fix-json-custom"
			config={config}
			defaultModel="hf:syntheticlab/fix-json"
			modelNickname="fix-json"
			onOverrideDefaultApiKey={onOverrideDefaultApiKey}
			onComplete={handleComplete}
			onCancel={handleCancel}
			env={env}
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
		</AutofixModelMenu>
	);
}

export function AutofixSetup({
	config,
	onComplete,
	onSkip,
	onOverrideDefaultApiKey,
	env,
	readKeyForModel,
	hasExistingKey,
}: {
	config?: Config | null;
	onComplete: (config: AutofixConfig) => void;
	onSkip: () => void;
	onOverrideDefaultApiKey: OverrideDefaultApiKey;
	env?: Record<string, string | undefined>;
	readKeyForModel?: ResolveSyntheticAutofixSelectionInput["readKeyForModel"];
	hasExistingKey?: ExistingKeyChecker;
}) {
	const activeConfig = config ?? null;
	const modelConnectionTest = useModelConnectionTest();
	const modelConnectionTestRef = useLatestRef(modelConnectionTest);
	const onCompleteRef = useLatestRef(onComplete);
	const onSkipRef = useLatestRef(onSkip);
	const configRef = useLatestRef(activeConfig);
	const onOverrideDefaultApiKeyRef = useLatestRef(onOverrideDefaultApiKey);
	const envRef = useLatestRef(env);
	const readKeyForModelRef = useLatestRef(readKeyForModel);
	const hasExistingKeyRef = useLatestRef(hasExistingKey);
	const complete = useCallback((config: AutofixConfig) => {
		onCompleteRef.current(config);
	}, []);
	const skip = useCallback(() => {
		onSkipRef.current();
	}, []);
	const overrideDefaultApiKey = useCallback(
		(override: Record<string, string>) => {
			return onOverrideDefaultApiKeyRef.current(override);
		},
		[],
	);
	const overrideSyntheticApiKey = useCallback((envVar: string) => {
		return onOverrideDefaultApiKeyRef.current({ synthetic: envVar });
	}, []);

	const routes = useMemo(
		() =>
			autofixSetupFlow.route({
				choose: (to) => (props) => (
					<AutofixSetupChooseRoute
						{...props}
						config={configRef.current}
						modelConnectionTest={modelConnectionTestRef.current}
						onComplete={complete}
						onSkip={skip}
						to={to}
						env={envRef.current}
						readKeyForModel={readKeyForModelRef.current}
					/>
				),
				syntheticSetup: (to) => () => (
					<AutofixSyntheticSetupRoute
						config={configRef.current}
						modelConnectionTest={modelConnectionTestRef.current}
						onComplete={complete}
						onOverrideDefaultApiKey={overrideDefaultApiKey}
						to={to}
						env={envRef.current}
						hasExistingKey={hasExistingKeyRef.current}
					/>
				),
				diffApplyCustom: (to) => () => (
					<AutofixDiffApplyCustomRoute
						config={configRef.current}
						onOverrideDefaultApiKey={overrideSyntheticApiKey}
						to={to}
						env={envRef.current}
					/>
				),
				fixJsonCustom: (to) => (props) => (
					<AutofixFixJsonCustomRoute
						{...props}
						config={configRef.current}
						onComplete={complete}
						onOverrideDefaultApiKey={overrideSyntheticApiKey}
						to={to}
						env={envRef.current}
					/>
				),
			}),
		[complete, overrideDefaultApiKey, overrideSyntheticApiKey, skip],
	);

	return <routes.Root route="choose" props={EMPTY_ROUTE_PROPS} />;
}
