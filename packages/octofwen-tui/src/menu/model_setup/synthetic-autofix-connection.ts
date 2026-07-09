import { errorToString } from "../../app/result.ts";
import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import type { ProviderConfig } from "../../internal/model-provider-catalog/main.ts";
import {
	type ModelConnectionTester,
	testConnection,
} from "./add-model-connection.ts";

export type SyntheticAutofixConnectionFailure = {
	step: "connection-failed";
	errorMessage: string;
};

export async function testSyntheticAutofixConnection({
	apiKey,
	model,
	modelConnectionTest,
	provider,
}: {
	apiKey: string;
	model: string;
	modelConnectionTest?: ModelConnectionTester;
	provider: ProviderConfig;
}): Promise<SyntheticAutofixConnectionFailure | null> {
	if (!modelConnectionTest) return null;
	try {
		const result = await modelConnectionTest({
			...(provider.type ? { type: provider.type } : {}),
			baseUrl: provider.baseUrl,
			apiKey,
			model,
		});
		if (result.valid) return null;
		return { step: "connection-failed", errorMessage: "Connection failed." };
	} catch (error) {
		return { step: "connection-failed", errorMessage: errorToString(error) };
	}
}

export async function testSyntheticAutofixAuth({
	config,
	auth,
	env = process.env,
	model,
	modelConnectionTest,
	provider,
}: {
	config: Config | null;
	auth?: Auth;
	env?: Record<string, string | undefined>;
	model: string;
	modelConnectionTest?: ModelConnectionTester;
	provider: ProviderConfig;
}): Promise<SyntheticAutofixConnectionFailure | null> {
	if (!modelConnectionTest) return null;
	const result = await testConnection({
		baseUrl: provider.baseUrl,
		provider,
		auth,
		config,
		env,
		model,
		modelConnectionTest,
	});
	if (result.valid) return null;
	return {
		step: "connection-failed",
		errorMessage: result.errorMessage ?? "Connection failed.",
	};
}
