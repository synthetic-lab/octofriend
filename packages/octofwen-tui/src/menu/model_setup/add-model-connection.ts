import { createContext, useContext } from "react";
import * as logger from "../../app/runtime_logging.ts";
import { trackTokens } from "../../app/token_usage.ts";
import { assertKeyForModel } from "../../internal/configuration/keys.ts";
import type {
	MinConnectArgs,
	ModelMetadata,
	TestConnectionResult,
} from "./add-model-types.ts";

export type ModelConnectionTestParams = {
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

export async function testConnection({
	model,
	auth,
	baseUrl,
	config,
	modelConnectionTest,
}: MinConnectArgs): Promise<TestConnectionResult> {
	try {
		const apiKey = await assertKeyForModel({ baseUrl, auth }, config);
		const result = await modelConnectionTest({ baseUrl, apiKey, model });
		if (!result.valid) return { valid: false };

		trackTokens(model, "input", result.promptTokens ?? 0);
		trackTokens(model, "output", result.completionTokens ?? 0);

		return { valid: true, metadata: result.metadata };
	} catch (error) {
		logger.error("verbose", error);
		return { valid: false };
	}
}
