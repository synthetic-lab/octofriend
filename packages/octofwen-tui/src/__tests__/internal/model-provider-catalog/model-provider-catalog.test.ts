import { describe, expect, it } from "bun:test";
import {
	canDisplayImage,
	DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	keyFromName,
	PROVIDERS,
	type ProviderConfig,
	providerForBaseUrl,
	recommendedModel,
	SYNTHETIC_PROVIDER,
} from "../../../internal/model-provider-catalog/main.ts";

type TestResult<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

function expectOk<T, E>(result: TestResult<T, E>): T {
	expect(result.success).toBe(true);
	return result.success ? result.data : (undefined as T);
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
		expect(SYNTHETIC_PROVIDER).toBe(PROVIDERS.synthetic);
		expect(recommendedModel("synthetic")).toEqual(
			PROVIDERS.synthetic.models[0],
		);
		expect(recommendedModel("openai").nickname).toBe("GPT-5.5");
		expect(PROVIDERS.anthropic.type).toBe("anthropic");
		expect(PROVIDERS.gemini.type).toBe("gemini");
		expect(PROVIDERS.gemini.envVar).toBe("GEMINI_API_KEY");
		expect(PROVIDERS.openai.apiKeyUrl).toBe(
			"https://platform.openai.com/api-keys",
		);
		expect(PROVIDERS.gemini.apiKeyUrl).toBe(
			"https://aistudio.google.com/apikey",
		);
		expect(PROVIDERS.grok.envVar).toBe("XAI_API_KEY");
		expect(PROVIDERS.grok.apiKeyUrl).toBe("https://console.x.ai/");
	});

	it("maps provider display names and base URLs to catalog entries", () => {
		expect(expectOk(keyFromName("Synthetic"))).toBe("synthetic");
		expect(expectOk(keyFromName("OpenAI"))).toBe("openai");
		expect(providerForBaseUrl("https://api.synthetic.new/v1")).toEqual(
			PROVIDERS.synthetic,
		);
		expect(providerForBaseUrl("https://api.anthropic.com")).toEqual(
			PROVIDERS.anthropic,
		);
		expect(
			providerForBaseUrl("https://generativelanguage.googleapis.com/v1beta"),
		).toEqual(PROVIDERS.gemini);
		expect(providerForBaseUrl("https://example.invalid")).toBeNull();
		const missingProvider = keyFromName("Missing Provider");
		expect(missingProvider.success).toBe(false);
		if (!missingProvider.success) {
			expect(missingProvider.error).toBe(
				"No provider named Missing Provider found",
			);
		}
	});

	it("keeps provider config typed without depending on UI modules", () => {
		const provider: ProviderConfig = {
			shortcut: "z",
			name: "Local",
			envVar: "LOCAL_API_KEY",
			baseUrl: "https://local.invalid/v1",
			apiKeyUrl: "https://local.invalid/keys",
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
			canDisplayImage(PROVIDERS.synthetic.models[0].modalities, {
				mimeType: "image/png",
				base64Data: "abc",
				dataUrl: "data:image/png;base64,abc",
				filePath: "image.png",
				sizeBytes: 1024,
			}),
		).toEqual({ ok: true });
		expect(
			canDisplayImage(PROVIDERS.grok.models[0].modalities, {
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
