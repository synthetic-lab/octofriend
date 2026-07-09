import type { Auth } from "../../runtime/config/schemas";
import type { ProviderConfig } from "../../runtime/models/catalog/main";

export type ModelSetupStepData =
	| {
			step: "initial";
	  }
	| {
			step: "custom";
	  }
	| {
			step: "found";
			provider: ProviderConfig;
			overrideAuth: Auth | null;
			useEnvVar: boolean;
	  }
	| {
			step: "missing";
			provider: ProviderConfig;
	  }
	| {
			step: "override-model-string";
			provider: ProviderConfig;
			overrideAuth: Auth | null;
			useEnvVar: boolean;
	  };

export type ModelSetupStepAction =
	| {
			from: ModelSetupStepData["step"];
			to: ModelSetupStepData;
	  }
	| {
			force: true;
			to: ModelSetupStepData;
	  };

export const RESET_MODEL_SETUP_TO_INITIAL_ACTION = {
	force: true,
	to: { step: "initial" },
} as const satisfies ModelSetupStepAction;

export type ModelSetupEscapeAction =
	| "cancel"
	| typeof RESET_MODEL_SETUP_TO_INITIAL_ACTION
	| null;

export function modelSetupEscapeAction(
	step: ModelSetupStepData["step"],
): ModelSetupEscapeAction {
	if (step === "initial") return "cancel";
	if (step === "custom") return null;
	return RESET_MODEL_SETUP_TO_INITIAL_ACTION;
}

export function reduceModelSetupStep(
	state: ModelSetupStepData,
	action: ModelSetupStepAction,
): ModelSetupStepData {
	if ("force" in action) return action.to;

	if (state.step === action.from) return action.to;
	return state;
}
