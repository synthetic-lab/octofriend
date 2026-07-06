import { err, ok, type Result } from "../../app/result.ts";
import { modelProviderCatalog } from "../configuration/agentd-config.ts";
import type { MultimodalConfig } from "../file-ir-optimization/main.ts";
import { canDisplayImage } from "../file-ir-optimization/main.ts";

export type {
	CanDisplayImageResult,
	ImageModalityConfig,
	MultimodalConfig,
} from "../file-ir-optimization/main.ts";
export { canDisplayImage };

export type ProviderShortcut =
	| "a"
	| "b"
	| "c"
	| "d"
	| "e"
	| "f"
	| "g"
	| "i"
	| "m"
	| "n"
	| "o"
	| "p"
	| "q"
	| "r"
	| "s"
	| "t"
	| "u"
	| "v"
	| "w"
	| "x"
	| "y"
	| "z";

export type ProviderModelConfig = {
	model: string;
	nickname: string;
	context: number;
	reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	thinkingBudgetTokens?: number;
	modalities?: MultimodalConfig;
};

export type ProviderConfig = {
	shortcut: ProviderShortcut;
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	name: string;
	envVar: string;
	baseUrl: string;
	apiKeyUrl: string;
	models: ProviderModelConfig[];
	testModel: string;
};

export type ProviderKey =
	| "synthetic"
	| "openai"
	| "anthropic"
	| "gemini"
	| "grok";

type CatalogResponse = {
	providers: Partial<Record<ProviderKey, ProviderConfig>>;
	syntheticProviderKey: ProviderKey;
	defaultMultimodalImageModelExample: string;
};

const catalog = (await modelProviderCatalog()) as CatalogResponse;

export const PROVIDERS = {
	synthetic: catalog.providers.synthetic,
	openai: catalog.providers.openai,
	anthropic: catalog.providers.anthropic,
	gemini: catalog.providers.gemini,
	grok: catalog.providers.grok,
};

export const DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE =
	catalog.defaultMultimodalImageModelExample;

export function recommendedModel(
	provider: ProviderKey,
	providers: Partial<
		Record<ProviderKey, ProviderConfig | undefined>
	> = PROVIDERS,
): ProviderModelConfig | null {
	return providers[provider]?.models[0] ?? null;
}

export const SYNTHETIC_PROVIDER =
	PROVIDERS[catalog.syntheticProviderKey] ?? null;

export function providerEntries(
	providers: Partial<
		Record<ProviderKey, ProviderConfig | undefined>
	> = PROVIDERS,
): [ProviderKey, ProviderConfig][] {
	return Object.entries(providers).filter(
		(entry): entry is [ProviderKey, ProviderConfig] => entry[1] !== undefined,
	);
}

export function providerValues(): ProviderConfig[] {
	return providerEntries().map(([, provider]) => provider);
}

export function keyFromName(name: string): Result<ProviderKey, string> {
	for (const [key, provider] of Object.entries(PROVIDERS) as [
		ProviderKey,
		ProviderConfig | undefined,
	][]) {
		if (!provider) continue;
		if (provider.name === name) return ok(key);
	}
	return err(`No provider named ${name} found`);
}

export function providerForBaseUrl(baseUrl: string): ProviderConfig | null {
	return (
		providerValues().find((provider) => provider.baseUrl === baseUrl) ?? null
	);
}
