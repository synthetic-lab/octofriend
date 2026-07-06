import {
	AgentdRustBridge,
	spawnAgentdProcessClient,
} from "../bridge/rust/agent.ts";
import type { MultimodalConfig } from "../file-ir-optimization/main.ts";
import { canDisplayImage } from "../file-ir-optimization/main.ts";
import { err, ok, type Result } from "../result.ts";

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
	providers: Record<ProviderKey, ProviderConfig>;
	syntheticProviderKey: ProviderKey;
	defaultMultimodalImageModelExample: string;
};

const catalog = await readModelProviderCatalog();

async function readModelProviderCatalog(): Promise<CatalogResponse> {
	const bridge = new AgentdRustBridge(spawnAgentdProcessClient());
	try {
		return (await bridge.modelProviderCatalog()) as CatalogResponse;
	} finally {
		bridge.close();
	}
}

export const PROVIDERS = {
	synthetic: catalog.providers.synthetic,
	openai: catalog.providers.openai,
	anthropic: catalog.providers.anthropic,
	gemini: catalog.providers.gemini,
	grok: catalog.providers.grok,
};

export const DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE =
	catalog.defaultMultimodalImageModelExample;

export function recommendedModel(provider: ProviderKey): ProviderModelConfig {
	return PROVIDERS[provider].models[0];
}

export const SYNTHETIC_PROVIDER = PROVIDERS[catalog.syntheticProviderKey];

export function providerValues(): ProviderConfig[] {
	return Object.values(PROVIDERS).filter(
		(provider): provider is ProviderConfig => provider !== undefined,
	);
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
