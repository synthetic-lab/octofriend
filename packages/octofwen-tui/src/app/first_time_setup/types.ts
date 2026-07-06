import type { Config } from "../../internal/configuration/schemas.ts";

export type AutofixConfig = {
	diffApply: Config["diffApply"];
	fixJson: Config["fixJson"];
};

export type FirstTimeSetupRouteData = {
	welcome: Record<string, never>;
	autofixSetup: Record<string, never>;
	autofixComplete: {
		autofixConfig: AutofixConfig;
	};
	addModel: {
		autofixConfig?: AutofixConfig;
	};
	name: {
		models: Config["models"];
		autofixConfig?: AutofixConfig;
	};
	done: Record<string, never>;
};

export type AutofixSetupRouteData = {
	choose: {
		errorMessage?: string;
	};
	syntheticSetup: Record<string, never>;
	diffApplyCustom: Record<string, never>;
	fixJsonCustom: {
		diffApplyConfig: Exclude<Config["diffApply"], undefined>;
	};
};
