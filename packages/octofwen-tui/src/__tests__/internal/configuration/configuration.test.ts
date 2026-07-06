import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import json5 from "json5";
import {
	readConfig,
	writeConfig,
} from "../../../internal/configuration/config-file.ts";
import { fileExists } from "../../../internal/configuration/filesystem.ts";
import {
	assertKeyForModel,
	hasExistingKeyForBaseUrl,
	readKeyForBaseUrl,
	readKeyForModelWithDetails,
	readSearchConfig,
} from "../../../internal/configuration/keys.ts";
import {
	withAllServersDisabled,
	withServerDisabled,
} from "../../../internal/configuration/lsp-config.ts";
import { getModelFromConfig } from "../../../internal/configuration/model-selection.ts";
import type { Config } from "../../../internal/configuration/schemas.ts";

const ENV_KEYS = [
	"SYNTHETIC_API_KEY",
	"OPENAI_API_KEY",
	"CUSTOM_API_KEY",
	"SEARCH_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = savedEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("configuration", () => {
	it("reads old config files, applies migrations, and persists the current version", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofwen-config-"));
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

			expect(config.configVersion).toBe(2);
			expect(config.notifications?.notifyCommand).toBe("say done");
			expect(config.models[0].modalities?.image?.acceptedMimeTypes).toContain(
				"image/webp",
			);
			const persisted = json5.parse(await readFile(configPath, "utf8"));
			expect(persisted.configVersion).toBe(2);
			expect(persisted.notifyFinishCommand).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects unknown keys in exact configuration shapes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "octofwen-config-"));
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
		const dir = await mkdtemp(join(tmpdir(), "octofwen-config-"));
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
		const dir = await mkdtemp(join(tmpdir(), "octofwen-config-"));
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
		const dir = await mkdtemp(join(tmpdir(), "octofwen-config-"));
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
					baseUrl: "https://api.openai.com/v1",
					apiEnvVar: "OPENAI_API_KEY",
					model: "gpt-5-mini",
				},
			};

			await writeConfig(config, configPath);

			const persisted = json5.parse(await readFile(configPath, "utf8"));
			expect(persisted.models[0].apiEnvVar).toBeUndefined();
			expect(persisted.diffApply.apiEnvVar).toBeUndefined();
			expect(persisted.configVersion).toBe(2);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("resolves environment, command, provider override, and missing auth results", async () => {
		process.env["SYNTHETIC_API_KEY"] = "synthetic-key";
		process.env["CUSTOM_API_KEY"] = "custom-key";

		await expect(
			readKeyForBaseUrl("https://api.synthetic.new/v1", null),
		).resolves.toBe("synthetic-key");
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
		process.env["SEARCH_API_KEY"] = "search-key";
		process.env["SYNTHETIC_API_KEY"] = "synthetic-key";
		const configured: Config = {
			yourName: "Ada",
			models: [],
			search: {
				url: "https://search.invalid",
				auth: { type: "env", name: "SEARCH_API_KEY" },
			},
		};

		await expect(readSearchConfig(configured)).resolves.toEqual({
			url: "https://search.invalid",
			key: "search-key",
		});
		await expect(
			readSearchConfig({ yourName: "Ada", models: [] }),
		).resolves.toEqual({
			url: "https://api.synthetic.new/v2/search",
			key: "synthetic-key",
		});
	});

	it("supports LSP disable helpers, model fallback, and key assertions", async () => {
		process.env["OPENAI_API_KEY"] = "openai-key";
		const config: Config = {
			yourName: "Ada",
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
		await expect(assertKeyForModel(config.models[0], config)).resolves.toBe(
			"openai-key",
		);
	});
});
