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

export type ProviderAuthMethod = "api-key" | "chatgpt-oauth";

export type ProviderConfig = {
	shortcut: ProviderShortcut;
	type?: "standard" | "openai-responses" | "anthropic" | "gemini";
	name: string;
	envVar: string;
	baseUrl: string;
	baseUrlAliases: string[];
	apiKeyUrl: string;
	authMethods: ProviderAuthMethod[];
	models: ProviderModelConfig[];
	testModel: string;
};

export type ProviderKey =
	| "synthetic"
	| "openai"
	| "anthropic"
	| "gemini"
	| "grok";

type ProviderMap<T> = Partial<Record<ProviderKey, T>>;
type OptionalProviderMap = ProviderMap<ProviderConfig | undefined>;
type ProviderEntry = [ProviderKey, ProviderConfig];
type ProviderBaseUrlMap = Map<string, ProviderConfig>;
type ProviderTypeMap = Partial<
	Record<NonNullable<ProviderConfig["type"]>, ProviderConfig>
>;
type ProviderModelLookupConfig = {
	baseUrl: string;
	model?: string;
	type?: ProviderConfig["type"];
};

const PROVIDER_KEYS = [
	"synthetic",
	"openai",
	"anthropic",
	"gemini",
	"grok",
] as const satisfies readonly ProviderKey[];

type CatalogResponse = {
	providers: ProviderMap<ProviderConfig>;
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

function collectProviderEntries(
	providers: OptionalProviderMap = PROVIDERS,
): ProviderEntry[] {
	const entries = new Array<ProviderEntry>(PROVIDER_KEYS.length);
	let writeIndex = 0;
	for (const key of PROVIDER_KEYS) {
		const provider = providers[key];
		if (provider !== undefined) {
			entries[writeIndex] = [key, provider];
			writeIndex += 1;
		}
	}
	if (writeIndex < entries.length) entries.length = writeIndex;
	return entries;
}

const DEFAULT_PROVIDER_ENTRIES = collectProviderEntries(PROVIDERS);
const DEFAULT_PROVIDER_VALUES = collectProviderValues(DEFAULT_PROVIDER_ENTRIES);
const DEFAULT_PROVIDERS_BY_BASE_URL = collectProvidersByBaseUrl(
	DEFAULT_PROVIDER_ENTRIES,
);
const DEFAULT_PROVIDERS_BY_TYPE = collectProvidersByType(
	DEFAULT_PROVIDER_ENTRIES,
);

function collectProviderValues(entries: ProviderEntry[]): ProviderConfig[] {
	const values = new Array<ProviderConfig>(entries.length);
	for (let index = 0; index < entries.length; index += 1) {
		values[index] = entries[index][1];
	}
	return values;
}

function collectProvidersByBaseUrl(
	entries: ProviderEntry[],
): ProviderBaseUrlMap {
	const providersByBaseUrl: ProviderBaseUrlMap = new Map();
	for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
		const provider = entries[entryIndex][1];
		setProviderBaseUrl(providersByBaseUrl, provider.baseUrl, provider);
		for (
			let aliasIndex = 0;
			aliasIndex < provider.baseUrlAliases.length;
			aliasIndex += 1
		) {
			setProviderBaseUrl(
				providersByBaseUrl,
				provider.baseUrlAliases[aliasIndex],
				provider,
			);
		}
	}
	return providersByBaseUrl;
}

function setProviderBaseUrl(
	providersByBaseUrl: ProviderBaseUrlMap,
	baseUrl: string,
	provider: ProviderConfig,
): void {
	const normalizedBaseUrl = normalizeProviderBaseUrl(baseUrl);
	if (!providersByBaseUrl.has(normalizedBaseUrl)) {
		providersByBaseUrl.set(normalizedBaseUrl, provider);
	}
}

function collectProvidersByType(entries: ProviderEntry[]): ProviderTypeMap {
	const providersByType: ProviderTypeMap = {};
	for (let index = 0; index < entries.length; index += 1) {
		const provider = entries[index][1];
		if (
			provider.type !== undefined &&
			providersByType[provider.type] === undefined
		) {
			providersByType[provider.type] = provider;
		}
	}
	return providersByType;
}

const PROVIDER_BASE_URL_ENV_VARS: ProviderMap<string> = {
	openai: "OPENAI_BASE_URL",
	anthropic: "ANTHROPIC_BASE_URL",
	gemini: "GEMINI_BASE_URL",
	synthetic: "SYNTHETIC_BASE_URL",
};

export function providerBaseUrlEnvVar(
	providerKey: ProviderKey,
): string | undefined {
	return PROVIDER_BASE_URL_ENV_VARS[providerKey];
}

export function resolveProviderBaseUrl(
	providerKey: ProviderKey,
	provider: ProviderConfig,
	env: Record<string, string | undefined> = process.env,
): string {
	const envVar = PROVIDER_BASE_URL_ENV_VARS[providerKey];
	const override = envVar ? env[envVar] : undefined;
	const trimmedOverride = override?.trim();
	return trimmedOverride && trimmedOverride.length > 0
		? trimmedOverride
		: provider.baseUrl;
}

export function providerWithResolvedBaseUrl(
	providerKey: ProviderKey,
	provider: ProviderConfig,
	env: Record<string, string | undefined> = process.env,
): ProviderConfig {
	const baseUrl = resolveProviderBaseUrl(providerKey, provider, env);
	if (baseUrl === provider.baseUrl) return provider;
	return {
		...provider,
		baseUrl,
		baseUrlAliases: providerBaseUrlAliasesWithCanonical(provider),
	};
}

function providerBaseUrlAliasesWithCanonical(
	provider: ProviderConfig,
): string[] {
	const aliases = provider.baseUrlAliases;
	const canonicalBaseUrl = normalizeProviderBaseUrl(provider.baseUrl);
	for (let index = 0; index < aliases.length; index += 1) {
		if (normalizeProviderBaseUrl(aliases[index]) === canonicalBaseUrl) {
			return aliases;
		}
	}
	return [provider.baseUrl, ...aliases];
}

export function recommendedModel(
	provider: ProviderKey,
	providers: OptionalProviderMap = PROVIDERS,
): ProviderModelConfig | null {
	return providers[provider]?.models[0] ?? null;
}

export const SYNTHETIC_PROVIDER_KEY = catalog.syntheticProviderKey;

export const SYNTHETIC_PROVIDER = PROVIDERS[SYNTHETIC_PROVIDER_KEY] ?? null;

export function providerEntries(
	providers: OptionalProviderMap = PROVIDERS,
): ProviderEntry[] {
	return providers === PROVIDERS
		? DEFAULT_PROVIDER_ENTRIES
		: collectProviderEntries(providers);
}

export function providerValues(): ProviderConfig[] {
	return DEFAULT_PROVIDER_VALUES;
}

export function keyFromName(name: string): Result<ProviderKey, string> {
	for (const key of PROVIDER_KEYS) {
		const provider = PROVIDERS[key];
		if (provider === undefined) continue;
		if (provider.name === name) return ok(key);
	}
	return err(`No provider named ${name} found`);
}

export function providerForBaseUrl(baseUrl: string): ProviderConfig | null {
	return (
		DEFAULT_PROVIDERS_BY_BASE_URL.get(normalizeProviderBaseUrl(baseUrl)) ?? null
	);
}

export function providerForModelConfig(
	model: ProviderModelLookupConfig,
): ProviderConfig | null {
	if (model.type && model.type !== "standard") {
		return DEFAULT_PROVIDERS_BY_TYPE[model.type] ?? null;
	}
	return providerForBaseUrl(model.baseUrl) ?? providerForModelName(model.model);
}

function providerForModelName(
	modelName: string | undefined,
): ProviderConfig | null {
	if (modelName === undefined) return null;
	for (const provider of DEFAULT_PROVIDER_VALUES) {
		for (let index = 0; index < provider.models.length; index += 1) {
			if (provider.models[index].model === modelName) return provider;
		}
	}
	return null;
}

export function providerBaseUrlsMatch(left: string, right: string): boolean {
	return normalizeProviderBaseUrl(left) === normalizeProviderBaseUrl(right);
}

export function normalizeProviderBaseUrl(baseUrl: string): string {
	const normalized = baseUrl.trim();
	let end = normalized.length;
	while (end > 1 && normalized.charCodeAt(end - 1) === 47) {
		end -= 1;
	}
	return end === normalized.length ? normalized : normalized.slice(0, end);
}
