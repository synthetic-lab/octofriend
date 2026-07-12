import { describe, expect, it } from "bun:test";
import {
	canDisplayImage,
	DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	keyFromName,
	PROVIDERS,
	type ProviderConfig,
	providerBaseUrlEnvVar,
	providerEntries,
	providerForBaseUrl,
	providerForModelConfig,
	recommendedModel,
	SYNTHETIC_PROVIDER,
} from "../../../../src/runtime/models/catalog/main";

type TestResult<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

function expectOk<T, E>(result: TestResult<T, E>): T {
	if (result.success) return result.data;
	throw new Error(String(result.error));
}

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("provider catalog", () => {
	it("exports built-in provider metadata with stable keys and recommended models", () => {
		expect(Object.keys(PROVIDERS)).toEqual([
			"synthetic",
			"openai",
			"anthropic",
			"gemini",
			"grok",
		]);
		expect(SYNTHETIC_PROVIDER).toBe(expectPresent(PROVIDERS.synthetic));
		expect(recommendedModel("synthetic")).toEqual(
			expectPresent(PROVIDERS.synthetic).models[0],
		);
		expect(recommendedModel("openai")).toEqual(
			expectPresent(PROVIDERS.openai).models[0],
		);
		expect(expectPresent(PROVIDERS.anthropic).type).toBe("anthropic");
		expect(expectPresent(PROVIDERS.gemini).type).toBe("gemini");
		expect(expectPresent(PROVIDERS.gemini).envVar).toBe("GEMINI_API_KEY");
		expect(expectPresent(PROVIDERS.openai).apiKeyUrl).toBe(
			"https://platform.openai.com/api-keys",
		);
		expect(expectPresent(PROVIDERS.openai).authMethods).toEqual([
			"chatgpt-oauth",
			"api-key",
		]);
		expect(expectPresent(PROVIDERS.gemini).apiKeyUrl).toBe(
			"https://aistudio.google.com/apikey",
		);
		expect(expectPresent(PROVIDERS.anthropic).authMethods).toEqual(["api-key"]);
		expect(expectPresent(PROVIDERS.gemini).authMethods).toEqual(["api-key"]);
		expect(expectPresent(PROVIDERS.grok).envVar).toBe("XAI_API_KEY");
		expect(expectPresent(PROVIDERS.grok).apiKeyUrl).toBe(
			"https://console.x.ai/",
		);
	});

	it("maps provider display names and base URLs to catalog entries", () => {
		expect(expectOk(keyFromName("Synthetic"))).toBe("synthetic");
		expect(expectOk(keyFromName("OpenAI"))).toBe("openai");
		expect(providerForBaseUrl("https://api.synthetic.new/v1")).toEqual(
			expectPresent(PROVIDERS.synthetic),
		);
		expect(providerForBaseUrl("https://api.synthetic.new/openai/v1")).toEqual(
			expectPresent(PROVIDERS.synthetic),
		);
		expect(providerForBaseUrl(" https://api.openai.com/v1/ ")).toEqual(
			expectPresent(PROVIDERS.openai),
		);
		expect(providerForBaseUrl(" https://api.openai.com/v1/// ")).toEqual(
			expectPresent(PROVIDERS.openai),
		);
		expect(providerForBaseUrl("https://api.synthetic.new/openai/v1/")).toEqual(
			expectPresent(PROVIDERS.synthetic),
		);
		expect(providerForBaseUrl("https://api.anthropic.com")).toEqual(
			expectPresent(PROVIDERS.anthropic),
		);
		expect(
			providerForBaseUrl("https://generativelanguage.googleapis.com/v1beta"),
		).toEqual(expectPresent(PROVIDERS.gemini));
		expect(providerForBaseUrl("https://example.invalid")).toBeNull();
		const missingProvider = keyFromName("Missing Provider");
		expect(missingProvider.success).toBe(false);
		if (!missingProvider.success) {
			expect(missingProvider.error).toBe(
				"No provider named Missing Provider found",
			);
		}
	});

	it("maps provider models with local base URL overrides by provider type", () => {
		expect(
			providerForModelConfig({
				type: "openai-responses",
				baseUrl: "http://127.0.0.1:8080/v1",
			}),
		).toEqual(expectPresent(PROVIDERS.openai));
		expect(
			providerForModelConfig({
				type: "anthropic",
				baseUrl: "http://127.0.0.1:8080",
			}),
		).toEqual(expectPresent(PROVIDERS.anthropic));
		expect(
			providerForModelConfig({
				type: "gemini",
				baseUrl: "http://127.0.0.1:8080/v1beta",
			}),
		).toEqual(expectPresent(PROVIDERS.gemini));
		expect(
			providerForModelConfig({
				type: "anthropic",
				baseUrl: "https://api.openai.com/v1",
			}),
		).toEqual(expectPresent(PROVIDERS.anthropic));
		expect(
			providerForModelConfig({
				type: "standard",
				baseUrl: "http://127.0.0.1:8080/v1",
				model: "hf:moonshotai/Kimi-K2.5",
			}),
		).toEqual(expectPresent(PROVIDERS.synthetic));
		expect(
			providerForModelConfig({
				type: "standard",
				baseUrl: "http://127.0.0.1:8080/v1",
			}),
		).toBeNull();
	});

	it("keeps local proxy env template aligned with API-key provider setup", async () => {
		const template = await Bun.file(
			new URL("../../../../../../.env.template", import.meta.url),
		).text();

		for (const providerKey of [
			"openai",
			"anthropic",
			"gemini",
			"synthetic",
		] as const) {
			const provider = expectPresent(PROVIDERS[providerKey]);
			const baseUrlEnvVar = expectPresent(providerBaseUrlEnvVar(providerKey));

			expect(template).toContain(`${baseUrlEnvVar}=http://127.0.0.1:8080`);
			expect(template).toContain(`${provider.envVar}=pwd`);
		}
	});

	it("filters missing provider entries from stale agentd catalogs", () => {
		const entries = providerEntries({
			synthetic: expectPresent(PROVIDERS.synthetic),
			openai: undefined,
		});

		expect(entries).toEqual([
			["synthetic", expectPresent(PROVIDERS.synthetic)],
		]);
	});

	it("returns no recommended model for a missing provider entry", () => {
		expect(
			recommendedModel("openai", {
				synthetic: expectPresent(PROVIDERS.synthetic),
				openai: undefined,
			}),
		).toBeNull();
	});

	it("keeps provider config typed without depending on UI modules", () => {
		const provider: ProviderConfig = {
			shortcut: "z",
			name: "Local",
			envVar: "LOCAL_API_KEY",
			baseUrl: "https://local.invalid/v1",
			baseUrlAliases: [],
			apiKeyUrl: "https://local.invalid/keys",
			authMethods: ["api-key"],
			models: [
				{
					model: "local-model",
					nickname: "Local Model",
					context: 4096,
					reasoning: "low",
				},
			],
			testModel: "local-model",
		};

		expect(provider.shortcut).toBe("z");
		expect(provider.models[0].reasoning).toBe("low");
	});

	it("re-exports multimodal image eligibility helpers", () => {
		expect(DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE).toBe("Kimi K2.5");
		expect(
			canDisplayImage(expectPresent(PROVIDERS.synthetic).models[0].modalities, {
				mimeType: "image/png",
				base64Data: "abc",
				dataUrl: "data:image/png;base64,abc",
				filePath: "image.png",
				sizeBytes: 1024,
			}),
		).toEqual({ ok: true });
		expect(
			canDisplayImage(expectPresent(PROVIDERS.grok).models[0].modalities, {
				mimeType: "image/gif",
				base64Data: "abc",
				dataUrl: "data:image/gif;base64,abc",
				filePath: "image.gif",
				sizeBytes: 1024,
			}),
		).toEqual({
			ok: false,
			reason:
				"Your model does not support image/gif images. Supported formats: image/jpeg, image/png.",
		});
	});
});
