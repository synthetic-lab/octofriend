import { parse } from "shell-quote";
import {
	keyFromName,
	type ProviderConfig,
	providerForBaseUrl,
} from "../../runtime/models/catalog/main.ts";
import { CHATGPT_OAUTH_ENV_VARS } from "./auth.ts";
import { nonEmptyEnvValue, nonEmptyTrimmedValue } from "./providers.ts";
import type { FullFlowRouteData } from "./types.ts";

export function envVarExampleForBaseUrl(
	baseUrl: string,
	provider?: Pick<ProviderConfig, "envVar">,
): string {
	return (
		provider?.envVar ?? providerForBaseUrl(baseUrl)?.envVar ?? "YOUR_API_KEY"
	);
}

export function normalizeEnvVarName(name: string): string {
	return nonEmptyTrimmedValue(name) ?? "";
}

export function envVarHasNonEmptyValue(
	name: string,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const normalizedName = normalizeEnvVarName(name);
	return (
		normalizedName.length > 0 && nonEmptyEnvValue(normalizedName, env) !== null
	);
}

export function validateApiKeyEnvVar(
	value: string,
	env: Record<string, string | undefined> = process.env,
) {
	const envVarName = normalizeEnvVarName(value);
	if (envVarName.length === 0) {
		return {
			valid: false as const,
			error: "Environment variable name can't be empty",
		};
	}
	if (nonEmptyEnvValue(envVarName, env) !== null)
		return { valid: true as const };

	return {
		valid: false as const,
		error: `
Env var ${envVarName} isn't defined in your current shell. Do you need to re-source your .bashrc or .zshrc?
          `.trim(),
	};
}

export function validateChatGptOAuthEnvVar(
	value: string,
	env: Record<string, string | undefined> = process.env,
) {
	const envVarName = normalizeEnvVarName(value);
	if (envVarName.length === 0) {
		return {
			valid: false as const,
			error: "Environment variable name can't be empty",
		};
	}
	if (nonEmptyEnvValue(envVarName, env) !== null)
		return { valid: true as const };
	if ((CHATGPT_OAUTH_ENV_VARS as readonly string[]).includes(envVarName))
		return { valid: true as const };

	return {
		valid: false as const,
		error: `
Env var ${envVarName} isn't defined in your current shell. If you use Codex CLI, run "codex login --device-auth" first, then expose an access token in this env var.
          `.trim(),
	};
}

export function secretPathExampleForBaseUrl(
	baseUrl: string,
	provider?: Pick<ProviderConfig, "name">,
): string {
	const resolvedProvider = provider ?? providerForBaseUrl(baseUrl);
	if (!resolvedProvider) return "provider";
	const key = keyFromName(resolvedProvider.name);
	return key.success ? key.data : resolvedProvider.name.toLowerCase();
}

export function providerForRouteProps(
	props: Pick<FullFlowRouteData["authAsk"], "baseUrl" | "provider">,
): ProviderConfig | undefined {
	if (props.provider) return props.provider;
	const provider = providerForBaseUrl(props.baseUrl);
	return provider ?? undefined;
}

export function parseCommandArgs(value: string): string[] {
	const parsed = parse(value);
	let index = 0;
	while (index < parsed.length) {
		if (typeof parsed[index] !== "string") break;
		index += 1;
	}
	if (index === parsed.length) return parsed as string[];

	const args = new Array<string>(parsed.length);
	let writeIndex = 0;
	index = 0;
	while (index < parsed.length) {
		const item = parsed[index];
		if (typeof item === "string") {
			args[writeIndex] = item;
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < args.length) args.length = writeIndex;
	return args;
}

export function validateCommandArgs(value: string) {
	const parsed = parse(value);
	let hasCommand = false;
	let index = 0;
	while (index < parsed.length) {
		const item = parsed[index];
		if (typeof item !== "string") {
			return {
				valid: false as const,
				error:
					"Shell operators like pipes (|) and redirects (>, <) aren't supported. Enter only the command and its arguments.",
			};
		}
		if (item.length > 0) hasCommand = true;
		index += 1;
	}
	if (!hasCommand) {
		return { valid: false as const, error: "Command can't be empty" };
	}
	return { valid: true as const };
}
