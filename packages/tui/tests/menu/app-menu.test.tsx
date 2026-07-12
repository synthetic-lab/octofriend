import { describe, expect, test } from "bun:test";
import { mergeAutofixCompletionConfig } from "../../src/menu/main/autofix-toggles.tsx";
import {
	appMenuFlow,
	buildMainMenuShortcutItems,
	buildNotificationShortcutItems,
	buildSettingsMenuShortcutItems,
	filterSettingsItems,
	handleMainMenuSelection,
	Menu,
	mainMenuShortcutState,
} from "../../src/menu/main/main.tsx";
import { resolveSwitchModelSelection } from "../../src/menu/main/model-switch.tsx";
import { buildModelShortcutItems } from "../../src/menu/main/models.tsx";
import type { Config } from "../../src/runtime/config/schemas.ts";

const config = {
	models: [
		{
			nickname: "one",
			baseUrl: "https://api.example.test/v1",
			model: "example-1",
			context: 128_000,
		},
	],
} as Config;

describe("terminal app menu", () => {
	test("exports the terminal app menu component", () => {
		expect(Menu).toBeFunction();
		expect(appMenuFlow.route).toBeFunction();
	});

	test("settings items omit model management when only one model exists", () => {
		expect(Object.keys(filterSettingsItems(config))).toEqual([]);
	});

	test("settings items include model and autofix controls when configurable", () => {
		const items = filterSettingsItems({
			...config,
			models: [
				...config.models,
				{
					nickname: "two",
					baseUrl: "https://api.example.test/v1",
					model: "example-2",
					context: 128_000,
				},
			],
			diffApply: {
				baseUrl: "https://synthetic.new/v1",
				model: "hf:syntheticlab/diff-apply",
				auth: { type: "env", name: "SYNTHETIC_API_KEY" },
			},
			fixJson: {
				baseUrl: "https://synthetic.new/v1",
				model: "hf:syntheticlab/fix-json",
				auth: { type: "env", name: "SYNTHETIC_API_KEY" },
			},
		});

		expect(Object.values(items).map((item) => item.value)).toEqual([
			"set-default-model",
			"remove-model",
			"disable-diff-apply",
			"disable-fix-json",
		]);
	});

	test("builds main menu shortcut data without per-render object spreading", () => {
		const items = buildMainMenuShortcutItems(config);

		expect(items).toEqual([
			{
				type: "key",
				mapping: {
					m: { label: "⤭ Switch model", value: "model-select" },
					a: { label: "+ Add a new model", value: "add-model" },
					c: { label: "⦿ New conversation", value: "clear-confirm" },
					v: { label: "♺ Switch to Vim mode", value: "vim-toggle" },
					f: {
						label: "🪄 Enable auto-fixing JSON tool calls",
						value: "fix-json-toggle",
					},
					d: {
						label: "💫 Enable fast diff application",
						value: "diff-apply-toggle",
					},
					n: { label: "🕭 Notifications", value: "notifications-menu" },
					b: { label: "⟵ Back to Octo", value: "return" },
					q: { label: "× Quit", value: "quit" },
				},
			},
		]);
		expect(buildMainMenuShortcutItems(config)).not.toBe(items);
	});

	test("main menu shortcut state ignores unrelated config object churn", () => {
		const state = mainMenuShortcutState(config);

		expect(
			mainMenuShortcutState({
				...config,
				yourName: "Different User",
				notifications: {
					notifyCommand: "notify",
					notifyTimeoutMs: 1000,
					alwaysNotify: true,
				},
			}),
		).toEqual(state);
	});

	test("main menu selection toggles vim config and resets insert mode only when enabling", async () => {
		const calls: string[] = [];
		const nextConfigs: Config[] = [];
		const context = (currentConfig: Config) => ({
			config: currentConfig,
			notify: (message: string) => calls.push(`notify:${message}`),
			onNavigate: {
				settingsMenu: () => calls.push("settings"),
				modelSelect: () => calls.push("model"),
				addModel: () => calls.push("add"),
				diffApplyToggle: () => calls.push("diff"),
				fixJsonToggle: () => calls.push("fix"),
				quitConfirm: () => calls.push("quit"),
				clearConfirm: () => calls.push("clear"),
				notificationsMenu: () => calls.push("notifications"),
			},
			resetPreMenuVimMode: () => calls.push("reset-vim"),
			setConfig: (nextConfig: Config) => {
				nextConfigs.push(nextConfig);
				return Promise.resolve();
			},
			toggleMenu: () => calls.push("toggle"),
		});

		await handleMainMenuSelection(
			{ label: "vim", value: "vim-toggle" },
			context(config),
		);
		await handleMainMenuSelection(
			{ label: "emacs", value: "vim-toggle" },
			context({ ...config, vimEmulation: { enabled: true } }),
		);

		expect(nextConfigs.map((nextConfig) => nextConfig.vimEmulation)).toEqual([
			{ enabled: true },
			{ enabled: false },
		]);
		expect(calls).toEqual([
			"reset-vim",
			"notify:Switched to Vim mode",
			"notify:Switched to Emacs mode",
		]);
	});

	test("builds settings menu shortcut data from the settings item helper", () => {
		expect(buildSettingsMenuShortcutItems(config)).toEqual([
			{
				type: "key",
				mapping: {
					b: { label: "Back", value: "back" },
				},
			},
		]);

		const items = buildSettingsMenuShortcutItems({
			...config,
			models: [
				...config.models,
				{
					nickname: "two",
					baseUrl: "https://api.example.test/v1",
					model: "example-2",
					context: 128_000,
				},
			],
			diffApply: {
				baseUrl: "https://synthetic.new/v1",
				model: "hf:syntheticlab/diff-apply",
				auth: { type: "env", name: "SYNTHETIC_API_KEY" },
			},
		});

		expect(items).toEqual([
			{
				type: "key",
				mapping: {
					c: { label: "Change the default model", value: "set-default-model" },
					r: { label: "Remove a model", value: "remove-model" },
					d: {
						label: "Disable fast diff application",
						value: "disable-diff-apply",
					},
					b: { label: "Back", value: "back" },
				},
			},
		]);
	});

	test("autofix completion preserves Synthetic env override with setting", () => {
		const setting = {
			baseUrl: "https://api.synthetic.new/v1",
			model: "hf:syntheticlab/fix-json",
			auth: { type: "env", name: "SYNTHETIC_MENU_KEY" },
		} as const;

		expect(
			mergeAutofixCompletionConfig(config, "fixJson", setting),
		).toMatchObject({
			defaultApiKeyOverrides: {
				synthetic: "SYNTHETIC_MENU_KEY",
			},
			fixJson: setting,
		});
	});

	test("builds notification shortcut data from notification state", () => {
		expect(
			buildNotificationShortcutItems({
				alwaysNotify: false,
				sessionAutoNotify: true,
				notifyOnce: false,
			}),
		).toEqual([
			{
				type: "key",
				mapping: {
					o: {
						label: "Notify the next time Octo needs input",
						value: "notify-once",
					},
					s: {
						label: "Stop auto-notifying this session",
						value: "session-notify",
					},
					a: { label: "Always auto-notify", value: "always-notify" },
					b: { label: "Back", value: "back" },
				},
			},
		]);
	});

	test("builds stable model management shortcut data from configured models", () => {
		const shortcutItems = buildModelShortcutItems([
			...config.models,
			{
				nickname: "two",
				baseUrl: "https://api.example.test/v1",
				model: "example-2",
				context: 128_000,
			},
		]);

		expect(shortcutItems).toEqual([
			{
				type: "auto-list",
				order: [
					{ label: "one", value: "model-one" },
					{ label: "two", value: "model-two" },
				],
			},
			{
				type: "key",
				mapping: {
					b: { label: "Back to main menu", value: "back" },
				},
			},
		]);
	});

	test("model switch selection blocks missing configured environment auth", async () => {
		const result = await resolveSwitchModelSelection({
			config: {
				...config,
				models: [
					...config.models,
					{
						nickname: "env-model",
						baseUrl: "https://api.env.example.test/v1",
						apiEnvVar: "MISSING_MODEL_KEY",
						model: "example-env",
						context: 128_000,
					},
				],
			},
			item: { label: "env-model", value: "model-env-model" },
			readKeyForModel: async () => ({
				ok: false,
				error: {
					type: "missing",
					message: "Environment variable MISSING_MODEL_KEY is not set",
				},
			}),
		});

		expect(result).toEqual({
			step: "auth-error",
			message: "Environment variable MISSING_MODEL_KEY is not set",
		});
	});

	test("model switch selection treats undefined structured auth as missing auth", async () => {
		const model = {
			nickname: "undefined-auth-model",
			baseUrl: "https://api.undefined-auth.example.test/v1",
			auth: undefined,
			model: "example-undefined-auth",
			context: 128_000,
		};
		const result = await resolveSwitchModelSelection({
			config: {
				...config,
				models: [model],
			},
			item: {
				label: "undefined-auth-model",
				value: "model-undefined-auth-model",
			},
			readKeyForModel: async () => ({
				ok: false,
				error: {
					type: "missing",
					message: "No API key found",
				},
			}),
		});

		expect(result).toEqual({ step: "set-api-key", model });
	});

	test("model switch selection treats empty apiEnvVar as missing auth", async () => {
		const result = await resolveSwitchModelSelection({
			config: {
				...config,
				models: [
					{
						nickname: "empty-env-model",
						baseUrl: "https://api.empty-env.example.test/v1",
						apiEnvVar: "",
						model: "example-empty-env",
						context: 128_000,
					},
				],
			},
			item: { label: "empty-env-model", value: "model-empty-env-model" },
			readKeyForModel: async () => ({
				ok: false,
				error: {
					type: "missing",
					message: "Environment variable  is not set",
				},
			}),
		});

		expect(result).toEqual({
			step: "set-api-key",
			model: {
				nickname: "empty-env-model",
				baseUrl: "https://api.empty-env.example.test/v1",
				apiEnvVar: "",
				model: "example-empty-env",
				context: 128_000,
			},
		});
	});

	test("model switch selection keeps key-file setup for models without configured auth", async () => {
		const model = config.models[0];
		const result = await resolveSwitchModelSelection({
			config,
			item: { label: model.nickname, value: `model-${model.nickname}` },
			readKeyForModel: async () => ({
				ok: false,
				error: {
					type: "missing",
					message: "No API key found for https://api.example.test/v1",
				},
			}),
		});

		expect(result).toEqual({ step: "set-api-key", model });
	});

	test("model switch selection switches when auth resolves", async () => {
		const result = await resolveSwitchModelSelection({
			config,
			item: { label: "one", value: "model-one" },
			readKeyForModel: async () => ({ ok: true, key: "secret" }),
		});

		expect(result).toEqual({ step: "switch", nickname: "one" });
	});
});
