import { resolveAgentdCommand } from "../agentd/command.ts";
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
	reasoning?: "low" | "medium" | "high";
	modalities?: MultimodalConfig;
};

export type ProviderConfig = {
	shortcut: ProviderShortcut;
	type?: "standard" | "openai-responses" | "anthropic";
	name: string;
	envVar: string;
	baseUrl: string;
	models: ProviderModelConfig[];
	testModel: string;
};

export type ProviderKey = "synthetic" | "openai" | "anthropic" | "grok";

const AGENTD_PROVIDER_CATALOG_COMMAND = resolveAgentdCommand();

type CatalogResponse = {
	providers: Record<ProviderKey, ProviderConfig>;
	syntheticProviderKey: ProviderKey;
	defaultMultimodalImageModelExample: string;
};

const catalog = (await modelProviderCatalog()) as CatalogResponse;

export const PROVIDERS = {
	synthetic: catalog.providers.synthetic,
	openai: catalog.providers.openai,
	anthropic: catalog.providers.anthropic,
	grok: catalog.providers.grok,
};

export const DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE =
	catalog.defaultMultimodalImageModelExample;

export function recommendedModel(provider: ProviderKey): ProviderModelConfig {
	const result = agentdProviderRequest(
		"octofwen.agentd/modelRecommendedModel",
		{ provider },
	);
	return (result as { model: ProviderModelConfig }).model;
}

export const SYNTHETIC_PROVIDER = PROVIDERS[catalog.syntheticProviderKey];

export function keyFromName(name: string): ProviderKey {
	const result = agentdProviderRequest(
		"octofwen.agentd/modelProviderKeyFromName",
		{ name },
	);
	return (result as { key: ProviderKey }).key;
}

export function providerForBaseUrl(baseUrl: string): ProviderConfig | null {
	const result = agentdProviderRequest(
		"octofwen.agentd/modelProviderForBaseUrl",
		{
			baseUrl,
		},
	);
	return (result as { provider: ProviderConfig | null }).provider;
}

function agentdProviderRequest(
	method: string,
	params: Record<string, unknown>,
): unknown {
	const id = 1;
	const stdin = new TextEncoder().encode(
		`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
	);
	const subprocess = Bun.spawnSync(AGENTD_PROVIDER_CATALOG_COMMAND, {
		stdin,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	if (subprocess.exitCode !== 0) {
		throw new Error(
			`octofwen-agentd exited with code ${subprocess.exitCode}: ${subprocess.stderr.toString()}`,
		);
	}
	const line = subprocess.stdout
		.toString()
		.split("\n")
		.find((entry) => entry.trim() !== "");
	if (!line) throw new Error("octofwen-agentd returned no response");
	const response = JSON.parse(line) as {
		result?: unknown;
		error?: { message?: string };
	};
	if (response.error) {
		throw new Error(response.error.message ?? "octofwen-agentd request failed");
	}
	return response.result;
}
