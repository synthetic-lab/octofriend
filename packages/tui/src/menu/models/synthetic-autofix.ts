import { readKeyForModel as readConfiguredKeyForModel } from "../../runtime/config/keys.ts";
import type { Auth, Config } from "../../runtime/config/schemas.ts";
import {
	type ProviderConfig,
	providerWithResolvedBaseUrl,
	SYNTHETIC_PROVIDER,
	SYNTHETIC_PROVIDER_KEY,
} from "../../runtime/models/catalog/main.ts";
import { errorToString } from "../../shell/result.ts";
import { apiKeyEnvAuth } from "./auth.ts";
import type { ModelConnectionTester } from "./connection.ts";
import { nonEmptyEnvValue, resolveProviderEnvVar } from "./providers.ts";
import {
	testSyntheticAutofixAuth,
	testSyntheticAutofixConnection,
} from "./synthetic-connection.ts";

export type AutofixDiffApplyConfig = Exclude<Config["diffApply"], undefined>;

export type SyntheticAutofixSelectionResult =
	| {
			step: "complete";
			diffApply: AutofixDiffApplyConfig;
	  }
	| {
			step: "missing-auth";
	  }
	| {
			step: "connection-failed";
			errorMessage: string;
	  };

export type ResolveSyntheticAutofixSelectionInput = {
	config: Pick<Config, "defaultApiKeyOverrides"> | null;
	defaultModel: string;
	env?: Record<string, string | undefined>;
	readKeyForModel?: (
		model: { baseUrl: string },
		config: Pick<Config, "defaultApiKeyOverrides"> | null,
	) => Promise<string | null>;
	modelConnectionTest?: ModelConnectionTester;
};

export type SyntheticAutofixConfig = {
	diffApply: AutofixDiffApplyConfig;
	fixJson: AutofixDiffApplyConfig;
};

export type SyntheticAutofixConfigResult =
	| { step: "complete"; config: SyntheticAutofixConfig }
	| { step: "missing-auth" }
	| { step: "connection-failed"; errorMessage: string };

export type ResolveSyntheticAutofixConfigInput = Omit<
	ResolveSyntheticAutofixSelectionInput,
	"defaultModel"
> & {
	diffApplyModel?: string;
	fixJsonModel?: string;
};

export type ResolveSyntheticAutofixSelectionFromAuthInput = {
	config: Config | null;
	defaultModel: string;
	auth?: Auth;
	env?: Record<string, string | undefined>;
	modelConnectionTest?: ModelConnectionTester;
};

export type ResolveSyntheticAutofixConfigFromAuthInput = Omit<
	ResolveSyntheticAutofixSelectionFromAuthInput,
	"defaultModel"
> & {
	diffApplyModel?: string;
	fixJsonModel?: string;
};

const MISSING_SYNTHETIC_PROVIDER_ERROR =
	"Synthetic provider is unavailable in the model provider catalog.";

export function syntheticProviderWithResolvedBaseUrl(
	env: Record<string, string | undefined> = process.env,
): ProviderConfig | null {
	if (!SYNTHETIC_PROVIDER) return null;
	return providerWithResolvedBaseUrl(
		SYNTHETIC_PROVIDER_KEY,
		SYNTHETIC_PROVIDER,
		env,
	);
}

export function syntheticAutofixDiffApplyFromAuth(
	defaultModel: string,
	auth?: Auth,
	provider: ProviderConfig | null = syntheticProviderWithResolvedBaseUrl(),
): AutofixDiffApplyConfig | null {
	if (!provider) return null;
	const diffApply: AutofixDiffApplyConfig = {
		baseUrl: provider.baseUrl,
		model: defaultModel,
	};
	if (auth) diffApply.auth = auth;
	return diffApply;
}

async function resolveSyntheticAutofixConfigPair<TInput extends object>({
	diffApplyModel,
	fixJsonModel,
	input,
	resolveSelection,
}: {
	diffApplyModel: string;
	fixJsonModel: string;
	input: TInput;
	resolveSelection: (
		input: TInput & { defaultModel: string },
	) => Promise<SyntheticAutofixSelectionResult>;
}): Promise<SyntheticAutofixConfigResult> {
	const diffApply = await resolveSelection({
		...input,
		defaultModel: diffApplyModel,
	});
	if (diffApply.step !== "complete") return diffApply;

	const fixJson = await resolveSelection({
		...input,
		defaultModel: fixJsonModel,
	});
	if (fixJson.step !== "complete") return fixJson;

	return {
		step: "complete",
		config: {
			diffApply: diffApply.diffApply,
			fixJson: fixJson.diffApply,
		},
	};
}

export function resolveSyntheticAutofixConfig({
	diffApplyModel = "hf:syntheticlab/diff-apply",
	fixJsonModel = "hf:syntheticlab/fix-json",
	...input
}: ResolveSyntheticAutofixConfigInput): Promise<SyntheticAutofixConfigResult> {
	return resolveSyntheticAutofixConfigPair({
		diffApplyModel,
		fixJsonModel,
		input,
		resolveSelection: resolveSyntheticAutofixSelection,
	});
}

export function resolveSyntheticAutofixConfigFromAuth({
	diffApplyModel = "hf:syntheticlab/diff-apply",
	fixJsonModel = "hf:syntheticlab/fix-json",
	...input
}: ResolveSyntheticAutofixConfigFromAuthInput): Promise<SyntheticAutofixConfigResult> {
	return resolveSyntheticAutofixConfigPair({
		diffApplyModel,
		fixJsonModel,
		input,
		resolveSelection: resolveSyntheticAutofixSelectionFromAuth,
	});
}

export async function resolveSyntheticAutofixSelectionFromAuth({
	config,
	defaultModel,
	auth,
	env = process.env,
	modelConnectionTest,
}: ResolveSyntheticAutofixSelectionFromAuthInput): Promise<SyntheticAutofixSelectionResult> {
	const syntheticProvider = syntheticProviderWithResolvedBaseUrl(env);
	if (!syntheticProvider) {
		return {
			step: "connection-failed",
			errorMessage: MISSING_SYNTHETIC_PROVIDER_ERROR,
		};
	}
	const connection = await testSyntheticAutofixAuth({
		config,
		auth,
		env,
		model: defaultModel,
		modelConnectionTest,
		provider: syntheticProvider,
	});
	if (connection) return connection;
	const diffApply = syntheticAutofixDiffApplyFromAuth(
		defaultModel,
		auth,
		syntheticProvider,
	);
	if (!diffApply) {
		return {
			step: "connection-failed",
			errorMessage: MISSING_SYNTHETIC_PROVIDER_ERROR,
		};
	}
	return {
		step: "complete",
		diffApply,
	};
}

export async function resolveSyntheticAutofixSelection({
	config,
	defaultModel,
	env = process.env,
	readKeyForModel: readKey,
	modelConnectionTest,
}: ResolveSyntheticAutofixSelectionInput): Promise<SyntheticAutofixSelectionResult> {
	const syntheticProvider = syntheticProviderWithResolvedBaseUrl(env);
	if (!syntheticProvider) {
		return {
			step: "connection-failed",
			errorMessage: MISSING_SYNTHETIC_PROVIDER_ERROR,
		};
	}
	const envVar = resolveProviderEnvVar(syntheticProvider, config, null);
	const envKey = nonEmptyEnvValue(envVar, env);
	if (envKey !== null) {
		const connection = await testSyntheticAutofixConnection({
			apiKey: envKey,
			model: defaultModel,
			modelConnectionTest,
			provider: syntheticProvider,
		});
		if (connection) return connection;
		return {
			step: "complete",
			diffApply: {
				baseUrl: syntheticProvider.baseUrl,
				auth: apiKeyEnvAuth(envVar),
				model: defaultModel,
			},
		};
	}

	let key: string | null;
	try {
		key = await (
			readKey ??
			((model) => readConfiguredKeyForModel(model, config as Config | null))
		)({ baseUrl: syntheticProvider.baseUrl }, config);
	} catch (error) {
		return { step: "connection-failed", errorMessage: errorToString(error) };
	}
	if (key === null) return { step: "missing-auth" };
	const connection = await testSyntheticAutofixConnection({
		apiKey: key,
		model: defaultModel,
		modelConnectionTest,
		provider: syntheticProvider,
	});
	if (connection) return connection;
	const diffApply = syntheticAutofixDiffApplyFromAuth(
		defaultModel,
		undefined,
		syntheticProvider,
	);
	if (!diffApply) {
		return {
			step: "connection-failed",
			errorMessage: MISSING_SYNTHETIC_PROVIDER_ERROR,
		};
	}
	return {
		step: "complete",
		diffApply,
	};
}
