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

describe("provider catalog", () => {
	it("exports built-in provider metadata with stable keys and recommended models", () => {
		expect(Object.keys(PROVIDERS)).toEqual([
			"synthetic",
			"openai",
			"anthropic",
			"grok",
		]);
		expect(SYNTHETIC_PROVIDER).toBe(PROVIDERS.synthetic);
		expect(recommendedModel("synthetic")).toEqual(
			PROVIDERS.synthetic.models[0],
		);
		expect(recommendedModel("openai").nickname).toBe("GPT-5.3 Codex");
		expect(PROVIDERS.anthropic.type).toBe("anthropic");
		expect(PROVIDERS.grok.envVar).toBe("XAI_API_KEY");
	});

	it("maps provider display names and base URLs to catalog entries", () => {
		expect(keyFromName("Synthetic")).toBe("synthetic");
		expect(keyFromName("OpenAI")).toBe("openai");
		expect(providerForBaseUrl("https://api.synthetic.new/v1")).toEqual(
			PROVIDERS.synthetic,
		);
		expect(providerForBaseUrl("https://api.anthropic.com")).toEqual(
			PROVIDERS.anthropic,
		);
		expect(providerForBaseUrl("https://example.invalid")).toBeNull();
		expect(() => keyFromName("Missing Provider")).toThrow(
			"No provider named Missing Provider found",
		);
	});

	it("keeps provider config typed without depending on UI modules", () => {
		const provider: ProviderConfig = {
			shortcut: "z",
			name: "Local",
			envVar: "LOCAL_API_KEY",
			baseUrl: "https://local.invalid/v1",
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
