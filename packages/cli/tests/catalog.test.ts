import { describe, expect, it } from "bun:test";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("CLI provider catalog", () => {
	it("maps provider models with local base URL overrides by provider type", async () => {
		const { PROVIDERS, providerForModelConfig, providerValues } = await import(
			"../src/models/catalog/main.ts"
		);

		expect(providerValues().map((provider) => provider.name)).toEqual([
			"Synthetic",
			"OpenAI",
			"Anthropic",
			"Google Gemini",
			"xAI",
		]);
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
				type: "standard",
				baseUrl: "http://127.0.0.1:8080/v1",
			}),
		).toBeNull();
	});
});
