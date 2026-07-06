import type { Config } from "../../internal/configuration/schemas.ts";

export type AutofixConfig = {
	diffApply: Config["diffApply"];
	fixJson: Config["fixJson"];
};

export type SetupStep =
	| {
			step: "welcome";
	  }
	| {
			step: "autofix-setup";
	  }
	| {
			step: "autofix-complete";
			autofixConfig: AutofixConfig;
	  }
	| {
			step: "name";
			models: Config["models"];
			autofixConfig?: AutofixConfig;
	  }
	| {
			step: "add-model";
			autofixConfig?: AutofixConfig;
	  }
	| {
			step: "done";
	  };
