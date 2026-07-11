import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import json5 from "json5";
import React from "react";
import {
	readConfig,
	writeConfig,
} from "../../../src/runtime/config/config-file.ts";
import { fileExists } from "../../../src/runtime/config/filesystem.ts";
import {
	assertKeyForModel,
	hasExistingKeyForBaseUrl,
	hasExistingKeyForModel,
	normalizeApiKeyForWrite,
	readKeyForBaseUrl,
	readKeyForModelWithDetails,
	readSearchConfig,
} from "../../../src/runtime/config/keys.ts";
import {
	withAllServersDisabled,
	withServerDisabled,
} from "../../../src/runtime/config/lsp-config.ts";
import { getModelFromConfig } from "../../../src/runtime/config/model-selection.ts";
import { ConfigContext } from "../../../src/runtime/config/react-context.ts";
import type { Config } from "../../../src/runtime/config/schemas.ts";
import { useModel } from "../../../src/shell/state/model-hook.ts";
import { useAppStore } from "../../../src/shell/state/store.ts";

const CURRENT_CONFIG_VERSION = 6;

const PATH_ENV_VALUE = process.env.PATH ?? "";

function echoCommand(value: string): string[] {
	return [process.execPath, "--eval", `console.log(${JSON.stringify(value)})`];
}

describe("configuration", () => {
	it("reads old config files, applies migrations, and persists the current version", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofriend-config-"));
		try {
			const configPath = join(dir, "config.json5");
			await writeFile(
				configPath,
				json5.stringify({
					yourName: "Ada",
					notifyFinishCommand: "say done",
					models: [
						{
							nickname: "Kimi K2.5",
							baseUrl: "https://api.synthetic.new/v1",
							model: "hf:moonshotai/Kimi-K2.5",
							context: 262144,
						},
					],
				}),
			);

			const config = await readConfig(configPath);

			expect(config.configVersion).toBe(CURRENT_CONFIG_VERSION);
			expect(config.notifications?.notifyCommand).toBe("say done");
			expect(config.models[0].modalities?.image?.acceptedMimeTypes).toContain(
				"image/webp",
			);
			const persisted = json5.parse(await readFile(configPath, "utf8"));
			expect(persisted.configVersion).toBe(CURRENT_CONFIG_VERSION);
			expect(persisted.notifyFinishCommand).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("migrates legacy octofriend Codex subscription models through readConfig", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofriend-config-"));
		try {
			const configPath = join(dir, "config.json5");
			await writeFile(
				configPath,
				json5.stringify({
					yourName: "Ada",
					models: [
						{
							type: "codex",
							nickname: "OpenAI Codex Subscription",
							auth: { type: "codex" },
							model: "gpt-5.5",
							context: 200 * 1024,
							reasoning: "xhigh",
						},
					],
				}),
			);

			const config = await readConfig(configPath);

			expect(config.models[0]).toMatchObject({
				type: "openai-responses",
				baseUrl: "https://api.openai.com/v1",
				auth: {
					type: "env",
					name: "CODEX_ACCESS_TOKEN",
					credential: "chatgpt-oauth",
				},
			});
			const persisted = json5.parse(await readFile(configPath, "utf8"));
			expect(persisted.models[0].type).toBe("openai-responses");
			expect(persisted.models[0].auth).toEqual({
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects unknown keys in exact configuration shapes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofriend-config-"));
		try {
			for (const [index, config] of (
				[
					{ yourName: "Ada", models: [], extra: 1 },
					{
						yourName: "Ada",
						models: [
							{
								nickname: "GPT",
								baseUrl: "https://api.openai.com/v1",
								model: "gpt",
								context: 100,
								extra: true,
							},
						],
					},
					{
						yourName: "Ada",
						models: [],
						mcpServers: { server: { command: "node", extra: true } },
					},
				] as const
			).entries()) {
				const configPath = join(dir, `invalid-${index}.json5`);
				await writeFile(configPath, json5.stringify(config));
				await expect(readConfig(configPath)).rejects.toThrow();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects mixed disabled LSP entries", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofriend-config-"));
		try {
			const configPath = join(dir, "invalid-lsp.json5");
			await writeFile(
				configPath,
				json5.stringify({
					yourName: "Ada",
					models: [],
					lsp: {
						typescript: {
							disabled: true,
							command: ["tsserver"],
							extensions: [".ts"],
							rootCandidates: ["package.json"],
						},
					},
				}),
			);
			await expect(readConfig(configPath)).rejects.toThrow();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("checks whether a config path exists", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofriend-config-"));
		try {
			const configPath = join(dir, "config.json5");
			await expect(fileExists(configPath)).resolves.toBe(false);
			await writeFile(configPath, "{}");
			await expect(fileExists(configPath)).resolves.toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("writes config without redundant built-in provider env vars", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofriend-config-"));
		try {
			const configPath = join(dir, "config.json5");
			const config: Config = {
				yourName: "Ada",
				models: [
					{
						nickname: "GPT-5 Mini",
						baseUrl: "https://api.openai.com/v1",
						apiEnvVar: "OPENAI_API_KEY",
						model: "gpt-5-mini",
						context: 200000,
					},
				],
				diffApply: {
					type: "openai-responses",
					baseUrl: "https://api.openai.com/v1",
					apiEnvVar: "OPENAI_API_KEY",
					model: "gpt-5-mini",
				},
			};

			await writeConfig(config, configPath);

			const persisted = json5.parse(await readFile(configPath, "utf8"));
			expect(persisted.models[0].apiEnvVar).toBeUndefined();
			expect(persisted.diffApply.apiEnvVar).toBeUndefined();
			expect(persisted.diffApply.type).toBe("openai-responses");
			expect(persisted.configVersion).toBe(CURRENT_CONFIG_VERSION);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("normalizes API keys before writing them to agentd", () => {
		expect(normalizeApiKeyForWrite(" sk-test ")).toBe("sk-test");
		expect(normalizeApiKeyForWrite(" \n\t ")).toBeNull();
	});

	it("resolves environment, command, provider override, and missing auth results", async () => {
		await expect(
			readKeyForBaseUrl("https://api.synthetic.new/v1", {
				yourName: "Ada",
				models: [],
				defaultApiKeyOverrides: { synthetic: "PATH" },
			}),
		).resolves.toBe(PATH_ENV_VALUE);
		await expect(
			readKeyForModelWithDetails(
				{
					baseUrl: "https://api.example.invalid/v1",
					auth: { type: "command", command: echoCommand("custom-key") },
				},
				null,
			),
		).resolves.toEqual({ ok: true, key: "custom-key" });
		await expect(
			readKeyForModelWithDetails({ baseUrl: "https://missing.invalid" }, null),
		).resolves.toEqual({
			ok: false,
			error: {
				type: "missing",
				message: "No API key found for https://missing.invalid",
			},
		});
	});
	it("uses configured search auth or falls back to Synthetic auth", async () => {
		const configured: Config = {
			yourName: "Ada",
			models: [],
			search: {
				url: "https://search.invalid",
				auth: { type: "command", command: echoCommand("search-key") },
			},
		};

		await expect(readSearchConfig(configured)).resolves.toEqual({
			url: "https://search.invalid",
			key: "search-key",
		});
		await expect(
			readSearchConfig({
				yourName: "Ada",
				models: [],
				defaultApiKeyOverrides: { synthetic: "PATH" },
			}),
		).resolves.toEqual({
			url: "https://api.synthetic.new/v2/search",
			key: PATH_ENV_VALUE,
		});
	});

	it("supports LSP disable helpers, model fallback, and key assertions", async () => {
		const config: Config = {
			yourName: "Ada",
			defaultApiKeyOverrides: { openai: "PATH" },
			models: [
				{
					nickname: "GPT-5 Mini",
					baseUrl: "https://api.openai.com/v1",
					model: "gpt-5-mini",
					context: 200000,
				},
			],
		};

		expect(withServerDisabled("typescript", config).lsp).toEqual({
			typescript: { disabled: true },
		});
		expect(withAllServersDisabled(config).lsp).toBe(false);
		expect(getModelFromConfig(config, "missing")).toEqual(config.models[0]);
		await expect(
			hasExistingKeyForBaseUrl("https://api.openai.com/v1", config),
		).resolves.toBe(true);
		await expect(
			hasExistingKeyForModel(
				{
					baseUrl: "https://api.openai.com/v1",
					type: "openai-responses",
				},
				config,
			),
		).resolves.toBe(true);
		await expect(assertKeyForModel(config.models[0], config)).resolves.toBe(
			PATH_ENV_VALUE,
		);
	});

	it("memoizes selected model lookup across unrelated component rerenders", async () => {
		const originalSpawnSync = Bun.spawnSync;
		const previousState = useAppStore.getState();
		const config: Config = {
			yourName: "Ada",
			models: [
				{
					nickname: "default",
					baseUrl: "https://api.openai.com/v1",
					model: "gpt-memo-proof",
					context: 200000,
				},
			],
		};
		let spawnCalls = 0;
		let rerenderParent: () => void = () => undefined;
		function Wrapper() {
			const [, setNonce] = React.useState(0);
			rerenderParent = () => setNonce((nonce) => nonce + 1);
			return React.createElement(
				ConfigContext.Provider,
				{ value: config },
				React.createElement(ModelProbe),
			);
		}
		function ModelProbe() {
			useModel();
			return null;
		}

		Bun.spawnSync = ((...args: Parameters<typeof Bun.spawnSync>) => {
			const stdin =
				typeof args[1]?.stdin === "string"
					? args[1].stdin
					: args[1]?.stdin instanceof Uint8Array
						? new TextDecoder().decode(args[1].stdin)
						: "";
			if (!stdin.includes("gpt-memo-proof")) {
				return originalSpawnSync(...args);
			}
			spawnCalls += 1;
			return {
				exitCode: 0,
				stderr: Buffer.from(""),
				stdout: Buffer.from(
					`${JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						result: { model: config.models[0] },
					})}\n`,
				),
			};
		}) as unknown as typeof Bun.spawnSync;

		try {
			useAppStore.setState({ modelOverride: null });
			const instance = render(React.createElement(Wrapper));
			await Bun.sleep(1);
			spawnCalls = 0;
			rerenderParent();
			await Bun.sleep(1);

			expect(spawnCalls).toBe(0);
			instance.unmount();
		} finally {
			Bun.spawnSync = originalSpawnSync;
			useAppStore.setState(previousState, true);
		}
	});
});
