import { createContext, useContext } from "react";
import { errorToString } from "../../shell/result";
import * as logger from "../../shell/runtime-logging";
import { trackTokens } from "../../shell/token-usage";
import { assertKeyForModel } from "../../runtime/config/keys";
import { providerForBaseUrl } from "../../runtime/models/catalog/main";
import type {
	MinConnectArgs,
	ModelMetadata,
	TestConnectionResult,
} from "./types";
import { authChoicesForProvider } from "./auth";
import { nonEmptyEnvValue } from "./providers";

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

export type ModelDiscoveryTester = (params: {
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	baseUrl: string;
	apiKey: string;
}) => Promise<{
	models: Array<{ id: string; name?: string; context_length?: number }>;
}>;

export type ModelConnectionTester = (
	params: ModelConnectionTestParams,
) => Promise<ModelConnectionTestResult>;

export const ModelDiscoveryContext = createContext<ModelDiscoveryTester>(
	async () => ({ models: [] }),
);

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
	if (auth.credential === "chatgpt-oauth") {
		const envAuth = resolveEnvAuthKey(auth, resolvedProvider, env);
		if (!envAuth.valid) {
			const envValue = nonEmptyEnvValue(auth.name ?? "", env);
			if (envValue === null && envAuth.errorMessage.includes("isn't defined")) {
				return {
					valid: true,
					apiKey: await assertKeyForModel(
						{ baseUrl, auth, type: providerType },
						config,
					),
				};
			}
			return envAuth;
		}
		return { valid: true, apiKey: `codex-oauth:${envAuth.apiKey}` };
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

		const oauthBaseUrl =
			auth?.type === "env" && auth.credential === "chatgpt-oauth"
				? "https://chatgpt.com/backend-api/codex"
				: baseUrl;
		const result = await modelConnectionTest({
			...(providerType ? { type: providerType } : {}),
			baseUrl: oauthBaseUrl,
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
