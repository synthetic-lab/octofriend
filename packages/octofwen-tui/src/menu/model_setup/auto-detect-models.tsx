import { useCallback, useReducer } from "react";
import { useLatestInput, useLatestRef } from "../../input/latest_input.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import { resolveProviderBaseUrl } from "../../internal/model-provider-catalog/main.ts";
import {
	ModelSetupCustomRoute,
	ModelSetupFoundRoute,
	ModelSetupInitialRoute,
	ModelSetupMissingAuthRoute,
	ModelSetupOverrideModelRoute,
} from "./auto-detect-routes.tsx";
import { modelSetupEscapeAction, reduceModelSetupStep } from "./setup-state.ts";

export { resolveProviderBaseUrl };

export type AutoDetectModelsProps = {
	onComplete: (models: Config["models"]) => void;
	onCancel: () => void;
	onOverrideDefaultApiKey: (o: Record<string, string>) => Promise<unknown>;
	config: Config | null;
	titleOverride?: string;
	env?: Record<string, string | undefined>;
};

export function ModelSetup({
	config,
	onComplete,
	onCancel,
	onOverrideDefaultApiKey,
	titleOverride,
	env,
}: AutoDetectModelsProps) {
	const [stepData, dispatch] = useReducer(reduceModelSetupStep, {
		step: "initial",
	});
	const onCancelRef = useLatestRef(onCancel);
	const stepRef = useLatestRef(stepData.step);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (!key.escape) return;
				const escapeAction = modelSetupEscapeAction(stepRef.current);
				if (escapeAction === "cancel") {
					onCancelRef.current();
					return;
				}
				if (escapeAction !== null) {
					dispatch(escapeAction);
				}
			},
			[onCancelRef, stepRef],
		),
	);

	switch (stepData.step) {
		case "initial":
			return (
				<ModelSetupInitialRoute
					config={config}
					dispatch={dispatch}
					onCancel={onCancel}
					titleOverride={titleOverride}
					env={env}
				/>
			);

		case "custom":
			return (
				<ModelSetupCustomRoute
					config={config}
					dispatch={dispatch}
					onComplete={onComplete}
				/>
			);

		case "found":
			return (
				<ModelSetupFoundRoute
					config={config}
					dispatch={dispatch}
					onComplete={onComplete}
					stepData={stepData}
				/>
			);

		case "missing":
			return (
				<ModelSetupMissingAuthRoute
					config={config}
					dispatch={dispatch}
					onOverrideDefaultApiKey={onOverrideDefaultApiKey}
					stepData={stepData}
					env={env}
				/>
			);

		case "override-model-string":
			return (
				<ModelSetupOverrideModelRoute
					config={config}
					dispatch={dispatch}
					onComplete={onComplete}
					stepData={stepData}
				/>
			);
		default:
			return null;
	}
}
