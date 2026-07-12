import { describe, expect, test } from "bun:test";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import { useState } from "react";
import type { AuthError, Config } from "../../src/runtime/config/schemas.ts";
import { AuthCommandErrorPanel } from "../../src/shell/auth-check/error.tsx";
import {
	PreflightAutofixAuth,
	PreflightModelAuth,
} from "../../src/shell/auth-check/main.tsx";
import {
	applyAutofixAuthToConfig,
	applyModelAuthToConfig,
	indexOfModel,
	providerForPreflightModel,
	resolveAutofixModelFromConfig,
	resolveModelFromConfig,
	shouldMergeEnvAuthAsDefaultApiKey,
} from "../../src/shell/auth-check/model-resolve.ts";
import { useAuthPreflightInput } from "../../src/shell/auth-check/use-input.ts";

function RetryPreflightHarness({
	validateAuth,
}: {
	validateAuth: () => Promise<boolean>;
}) {
	const [authError, setAuthError] = useState<AuthError | null>({
		type: "command_failed",
		message: "command failed",
	});
	const [exitMessage, setExitMessage] = useState<string | null>(null);
	const [isRetrying, setIsRetrying] = useState(false);
	const [didExit, setDidExit] = useState(false);

	useAuthPreflightInput({
		authError,
		exit: () => setDidExit(true),
		isRetrying,
		setAuthError,
		setExitMessage,
		setIsRetrying,
		validateAuth,
	});

	return (
		<Box flexDirection="column">
			{authError?.type === "command_failed" && (
				<AuthCommandErrorPanel authError={authError} isRetrying={isRetrying} />
			)}
			{exitMessage && <Text>{exitMessage}</Text>}
			{didExit && <Text>exited</Text>}
		</Box>
	);
}

async function waitForRenderedText(
	lastFrame: () => string | undefined,
	expected: string,
): Promise<string> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const frame = lastFrame() ?? "";
		if (frame.includes(expected)) return frame;
		await Bun.sleep(5);
	}
	return lastFrame() ?? "";
}

const CURRENT_CONFIG_VERSION = 6;

const config: Config = {
	configVersion: CURRENT_CONFIG_VERSION,
	yourName: "Test User",
	models: [
		{
			nickname: "Primary",
			baseUrl: "https://example.invalid/v1",
			model: "primary-model",
			context: 1000,
		},
		{
			nickname: "Fallback",
			baseUrl: "https://fallback.invalid/v1",
			model: "fallback-model",
			context: 2000,
		},
	],
	diffApply: {
		baseUrl: "https://diff.invalid/v1",
		model: "diff-model",
	},
};

describe("terminal auth preflight", () => {
	test("exports preflight auth components", () => {
		expect(PreflightModelAuth).toBeFunction();
		expect(PreflightAutofixAuth).toBeFunction();
	});

	test("resolves a reloaded model by nickname and base URL before falling back to base URL", () => {
		expect(
			resolveModelFromConfig(config, {
				nickname: "Primary",
				baseUrl: "https://example.invalid/v1",
				model: "stale-model",
				context: 1,
			}),
		).toBe(config.models[0]);

		expect(
			resolveModelFromConfig(config, {
				nickname: "Primary",
				baseUrl: " https://example.invalid/v1/ ",
				model: "stale-model",
				context: 1,
			}),
		).toBe(config.models[0]);

		expect(
			resolveModelFromConfig(config, {
				nickname: "Changed",
				baseUrl: "https://fallback.invalid/v1",
				model: "stale-model",
				context: 1,
			}),
		).toBe(config.models[1]);
	});

	test("does not resolve a reloaded model to a different explicit provider type", () => {
		const proxyConfig: Config = {
			...config,
			models: [
				{
					type: "openai-responses",
					nickname: "Proxy",
					baseUrl: "http://127.0.0.1:8080/v1",
					model: "gpt-5-mini",
					context: 200000,
				},
				{
					type: "anthropic",
					nickname: "Proxy",
					baseUrl: "http://127.0.0.1:8080/v1",
					model: "claude-sonnet-5",
					context: 200000,
				},
			],
		};
		const staleAnthropicModel = {
			type: "anthropic" as const,
			nickname: "Proxy",
			baseUrl: " http://127.0.0.1:8080/v1/ ",
			model: "stale-claude",
			context: 1,
		};

		expect(resolveModelFromConfig(proxyConfig, staleAnthropicModel)).toBe(
			proxyConfig.models[1],
		);
		expect(indexOfModel(proxyConfig.models, staleAnthropicModel)).toBe(1);
	});

	test("finds a model index after config reload replaces object identity", () => {
		expect(
			indexOfModel(config.models, {
				nickname: "Primary",
				baseUrl: "https://example.invalid/v1",
				model: "stale-primary-model",
				context: 1,
			}),
		).toBe(0);

		expect(
			indexOfModel(config.models, {
				nickname: "Renamed",
				baseUrl: " https://fallback.invalid/v1/ ",
				model: "stale-fallback-model",
				context: 1,
			}),
		).toBe(1);
	});

	test("resolves an autofix model from the reloaded matching config entry", () => {
		const diffApply = config.diffApply;
		expect(diffApply).toBeDefined();
		if (!diffApply) return;

		expect(
			resolveAutofixModelFromConfig(
				config,
				{
					baseUrl: " https://diff.invalid/v1/ ",
					model: "stale-diff-model",
				},
				"diffApply",
			),
		).toBe(diffApply);
	});

	test("applies model auth to the reloaded config without clobbering newer edits", () => {
		const reloadedConfig: Config = {
			...config,
			yourName: "New User",
			models: [
				{
					...config.models[0],
					model: "new-primary-model",
					context: 4000,
					apiEnvVar: "STALE_PRIMARY_KEY",
				},
				config.models[1],
			],
		};
		const applied = applyModelAuthToConfig(
			reloadedConfig,
			{
				nickname: "Primary",
				baseUrl: "https://example.invalid/v1",
				model: "stale-primary-model",
				context: 1,
			},
			{
				type: "command",
				command: ["printf", "primary-key"],
			},
		);

		expect(applied).not.toBeNull();
		expect(applied?.config.yourName).toBe("New User");
		expect(applied?.model.model).toBe("new-primary-model");
		expect(applied?.model.context).toBe(4000);
		expect(applied?.model.auth).toEqual({
			type: "command",
			command: ["printf", "primary-key"],
		});
		expect(applied?.model.apiEnvVar).toBeUndefined();
		expect(applied?.config.models[1]).toBe(config.models[1]);
	});

	test("applies autofix auth to the reloaded config without clobbering newer edits", () => {
		const reloadedConfig: Config = {
			...config,
			yourName: "New User",
			diffApply: {
				baseUrl: "https://diff.invalid/v1",
				model: "new-diff-model",
				apiEnvVar: "NEW_DIFF_API_KEY",
			},
		};
		const applied = applyAutofixAuthToConfig(
			reloadedConfig,
			{
				baseUrl: "https://diff.invalid/v1",
				model: "stale-diff-model",
			},
			"diffApply",
			{
				type: "command",
				command: ["printf", "diff-key"],
			},
		);

		expect(applied.config.yourName).toBe("New User");
		expect(applied.model.model).toBe("new-diff-model");
		expect(applied.model.apiEnvVar).toBeUndefined();
		expect(applied.model.auth).toEqual({
			type: "command",
			command: ["printf", "diff-key"],
		});
		expect(applied.config.models).toBe(reloadedConfig.models);
	});

	test("resolves provider metadata for local provider base URL overrides", () => {
		expect(
			providerForPreflightModel({
				type: "openai-responses",
				baseUrl: "http://127.0.0.1:8080/v1",
			})?.name,
		).toBe("OpenAI");
		expect(
			providerForPreflightModel({
				type: "anthropic",
				baseUrl: "http://127.0.0.1:8080",
			})?.name,
		).toBe("Anthropic");
		expect(
			providerForPreflightModel({
				type: "gemini",
				baseUrl: "http://127.0.0.1:8080/v1beta",
			})?.name,
		).toBe("Google Gemini");
	});

	test("keeps auth retry interactive when validation throws", async () => {
		const { stdin, lastFrame } = render(
			<RetryPreflightHarness
				validateAuth={() => Promise.reject(new Error("config unreadable"))}
			/>,
		);

		stdin.write("r");

		const frame = await waitForRenderedText(
			lastFrame,
			"Retry failed: config unreadable",
		);
		expect(frame).toContain("Your auth command failed");
		expect(frame).toContain("Retry failed: config unreadable");
		expect(frame).not.toContain("(retrying...)");
		expect(frame).not.toContain("exited");
	});

	test("normalizes auth command error line breaks before rendering", () => {
		const { lastFrame } = render(
			<AuthCommandErrorPanel
				authError={{
					type: "command_failed",
					message: "command\r\nfailed\ragain",
					stderr: "stderr\r\nline\rmore",
				}}
				isRetrying={false}
			/>,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain("command");
		expect(frame).toContain("failed");
		expect(frame).toContain("again");
		expect(frame).toContain("stderr");
		expect(frame).toContain("line");
		expect(frame).toContain("more");
		expect(frame).not.toContain("\r");
	});

	test("uses the latest auth retry validator after rerender", async () => {
		const calls: string[] = [];
		const instance = render(
			<RetryPreflightHarness
				validateAuth={() => {
					calls.push("first");
					return Promise.resolve(false);
				}}
			/>,
		);

		instance.rerender(
			<RetryPreflightHarness
				validateAuth={() => {
					calls.push("second");
					return Promise.resolve(false);
				}}
			/>,
		);
		instance.stdin.write("r");
		await Bun.sleep(1);

		expect(calls).toEqual(["second"]);
	});

	test("does not merge ChatGPT OAuth env auth as an API-key default override", () => {
		expect(
			shouldMergeEnvAuthAsDefaultApiKey({
				type: "env",
				name: "OPENAI_API_KEY",
				credential: "api-key",
			}),
		).toBe(true);
		expect(
			shouldMergeEnvAuthAsDefaultApiKey({
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			}),
		).toBe(false);
		expect(
			shouldMergeEnvAuthAsDefaultApiKey({
				type: "env",
				name: "FUTURE_TOKEN",
				credential: "future-token",
			} as unknown as import("../../src/runtime/config/schemas").Auth),
		).toBe(false);
	});
});
