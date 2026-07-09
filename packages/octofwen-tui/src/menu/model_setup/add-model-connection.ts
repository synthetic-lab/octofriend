import { createContext, useContext } from "react";
import { errorToString } from "../../app/result.ts";
import * as logger from "../../app/runtime_logging.ts";
import { trackTokens } from "../../app/token_usage.ts";
import { assertKeyForModel } from "../../internal/configuration/keys.ts";
import { providerForBaseUrl } from "../../internal/model-provider-catalog/main.ts";
import type {
	MinConnectArgs,
	ModelMetadata,
	TestConnectionResult,
} from "./add-model-types.ts";
import { authChoicesForProvider } from "./provider-auth.ts";
import { nonEmptyEnvValue } from "./provider-helpers.ts";

export type ModelConnectionTestParams = {
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	baseUrl: string;
	apiKey: string;
	model: string;
};

export type ModelConnectionTestResult =
	| {
			valid: true;
			promptTokens?: number;
			completionTokens?: number;
			metadata: ModelMetadata;
	  }
	| { valid: false };

export type ModelConnectionTester = (
	params: ModelConnectionTestParams,
) => Promise<ModelConnectionTestResult>;

export const ModelConnectionTestContext = createContext<ModelConnectionTester>(
	async () => ({ valid: false }),
);

export function useModelConnectionTest(): ModelConnectionTester {
	return useContext(ModelConnectionTestContext);
}

type ApiKeyResolution =
	| { valid: true; apiKey: string }
	| { valid: false; errorMessage: string };

async function resolveConnectionApiKey({
	auth,
	baseUrl,
	config,
	env,
	providerType,
	resolvedProvider,
}: Pick<MinConnectArgs, "auth" | "baseUrl" | "config" | "env"> & {
	providerType: ModelConnectionTestParams["type"] | undefined;
	resolvedProvider: ReturnType<typeof providerForBaseUrl> | undefined;
}): Promise<ApiKeyResolution> {
	if (auth?.type !== "env") {
		return {
			valid: true,
			apiKey: await assertKeyForModel(
				{ baseUrl, auth, type: providerType },
				config,
			),
		};
	}

	const envAuth = resolveEnvAuthKey(auth, resolvedProvider, env);
	if (!envAuth.valid) return envAuth;
	return { valid: true, apiKey: envAuth.apiKey };
}

function resolveEnvAuthKey(
	auth: Extract<MinConnectArgs["auth"], { type: "env" }>,
	resolvedProvider: ReturnType<typeof providerForBaseUrl> | undefined,
	env: MinConnectArgs["env"],
): ApiKeyResolution {
	if (typeof auth.name !== "string" || auth.name.trim().length === 0) {
		return { valid: false, errorMessage: "Environment auth name is missing." };
	}
	if (auth.credential === "chatgpt-oauth") {
		const { supportsChatGptOAuth } = authChoicesForProvider(resolvedProvider);
		if (!supportsChatGptOAuth) {
			return {
				valid: false,
				errorMessage: "ChatGPT OAuth is only supported for OpenAI providers.",
			};
		}
	}

	const apiKey = nonEmptyEnvValue(auth.name, env);
	if (apiKey !== null) return { valid: true, apiKey };
	return {
		valid: false,
		errorMessage: `Env var ${auth.name} isn't defined in your current shell.`,
	};
}

export async function testConnection({
	model,
	auth,
	baseUrl,
	provider,
	config,
	modelConnectionTest,
	env,
}: MinConnectArgs): Promise<TestConnectionResult> {
	try {
		const resolvedProvider =
			provider ?? providerForBaseUrl(baseUrl) ?? undefined;
		const providerType = resolvedProvider?.type;
		const apiKey = await resolveConnectionApiKey({
			auth,
			baseUrl,
			config,
			env,
			providerType,
			resolvedProvider,
		});
		if (!apiKey.valid) return apiKey;

		const result = await modelConnectionTest({
			...(providerType ? { type: providerType } : {}),
			baseUrl,
			apiKey: apiKey.apiKey,
			model,
		});
		if (!result.valid) return { valid: false };

		trackTokens(model, "input", result.promptTokens ?? 0);
		trackTokens(model, "output", result.completionTokens ?? 0);

		return { valid: true, metadata: result.metadata };
	} catch (error) {
		logger.error("verbose", error);
		return { valid: false, errorMessage: errorToString(error) };
	}
}
