import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { useAppStore } from "../../app/state/store.ts";
import { ConfigContext } from "../../internal/configuration/react-context.ts";
import type { Config } from "../../internal/configuration/schemas.ts";

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

describe("terminal app menu rerenders", () => {
	test("notifications menu uses latest back callback after rerender", async () => {
		const { NotificationsMenu } = await import(
			"../../menu/app_menu/notifications-menu.tsx"
		);
		const calls: string[] = [];
		const previousState = useAppStore.getState();
		const renderMenu = (onBack: () => void) => (
			<ConfigContext.Provider value={config}>
				<NotificationsMenu onBack={onBack} />
			</ConfigContext.Provider>
		);

		try {
			const instance = render(renderMenu(() => calls.push("first:back")));
			instance.rerender(renderMenu(() => calls.push("second:back")));
			instance.stdin.write("b");
			await Bun.sleep(0);

			expect(calls).toEqual(["second:back"]);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState, true);
		}
	});

	test("default model menu uses latest back callback after rerender", async () => {
		const { SetDefaultModelMenu } = await import(
			"../../menu/app_menu/model-management.tsx"
		);
		const calls: string[] = [];
		const previousState = useAppStore.getState();
		const modelConfig = {
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
		} as Config;
		const renderMenu = (onBack: () => void) => (
			<ConfigContext.Provider value={modelConfig}>
				<SetDefaultModelMenu onBack={onBack} />
			</ConfigContext.Provider>
		);

		try {
			const instance = render(renderMenu(() => calls.push("first:back")));
			instance.rerender(renderMenu(() => calls.push("second:back")));
			instance.stdin.write("b");
			await Bun.sleep(0);

			expect(calls).toEqual(["second:back"]);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState, true);
		}
	});

	test("settings menu uses latest navigation callbacks after rerender", async () => {
		const { SettingsMenu } = await import(
			"../../menu/app_menu/settings-menu.tsx"
		);
		const calls: string[] = [];
		const settingsConfig = {
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
		} as Config;
		const firstNavigate = {
			setDefaultModel: () => calls.push("first:set-default"),
			removeModel: () => calls.push("first:remove"),
			diffApplyToggle: () => calls.push("first:diff"),
			fixJsonToggle: () => calls.push("first:fix"),
		};
		const secondNavigate = {
			setDefaultModel: () => calls.push("second:set-default"),
			removeModel: () => calls.push("second:remove"),
			diffApplyToggle: () => calls.push("second:diff"),
			fixJsonToggle: () => calls.push("second:fix"),
		};
		const renderMenu = (onNavigate: typeof firstNavigate) => (
			<ConfigContext.Provider value={settingsConfig}>
				<SettingsMenu
					onBack={() => calls.push("back")}
					onNavigate={onNavigate}
				/>
			</ConfigContext.Provider>
		);

		const instance = render(renderMenu(firstNavigate));
		instance.rerender(renderMenu(secondNavigate));
		instance.stdin.write("c");
		await Bun.sleep(0);

		expect(calls).toEqual(["second:set-default"]);
		instance.unmount();
	});

	test("model switch uses latest back callback after rerender", async () => {
		const { SwitchModelMenu } = await import(
			"../../menu/app_menu/model-switching.tsx"
		);
		const calls: string[] = [];
		const previousState = useAppStore.getState();
		useAppStore.setState({ modelOverride: null });
		const renderMenu = (onBack: () => void) => (
			<ConfigContext.Provider value={config}>
				<SwitchModelMenu onBack={onBack} />
			</ConfigContext.Provider>
		);

		try {
			const instance = render(renderMenu(() => calls.push("first:back")));
			instance.rerender(renderMenu(() => calls.push("second:back")));
			instance.stdin.write("b");
			await Bun.sleep(0);

			expect(calls).toEqual(["second:back"]);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState, true);
		}
	});

	test("main menu uses latest navigation callbacks after rerender", async () => {
		const { MainMenu } = await import("../../menu/app_menu/main-menu.tsx");
		const calls: string[] = [];
		const previousState = useAppStore.getState();
		useAppStore.setState({ modelOverride: null });
		const firstNavigate = {
			settingsMenu: () => calls.push("first:settings"),
			modelSelect: () => calls.push("first:model"),
			addModel: () => calls.push("first:add"),
			diffApplyToggle: () => calls.push("first:diff"),
			fixJsonToggle: () => calls.push("first:fix"),
			quitConfirm: () => calls.push("first:quit"),
			clearConfirm: () => calls.push("first:clear"),
			notificationsMenu: () => calls.push("first:notifications"),
		};
		const secondNavigate = {
			settingsMenu: () => calls.push("second:settings"),
			modelSelect: () => calls.push("second:model"),
			addModel: () => calls.push("second:add"),
			diffApplyToggle: () => calls.push("second:diff"),
			fixJsonToggle: () => calls.push("second:fix"),
			quitConfirm: () => calls.push("second:quit"),
			clearConfirm: () => calls.push("second:clear"),
			notificationsMenu: () => calls.push("second:notifications"),
		};
		const renderMenu = (onNavigate: typeof firstNavigate) => (
			<ConfigContext.Provider value={config}>
				<MainMenu onNavigate={onNavigate} />
			</ConfigContext.Provider>
		);

		try {
			const instance = render(renderMenu(firstNavigate));
			instance.rerender(renderMenu(secondNavigate));
			instance.stdin.write("a");
			await Bun.sleep(0);

			expect(calls).toEqual(["second:add"]);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState, true);
		}
	});

	test("main menu does not rerender shortcuts for non-Synthetic model switches", async () => {
		const { MainMenu } = await import("../../menu/app_menu/main-menu.tsx");
		const previousState = useAppStore.getState();
		let updateCommits = 0;
		const multiOpenAiConfig = {
			...config,
			models: [
				{
					nickname: "one",
					baseUrl: "https://api.openai.com/v1",
					model: "model-one",
					context: 128_000,
				},
				{
					nickname: "two",
					baseUrl: "https://api.openai.com/v1",
					model: "model-two",
					context: 128_000,
				},
			],
		} as Config;
		const navigation = {
			settingsMenu: () => undefined,
			modelSelect: () => undefined,
			addModel: () => undefined,
			diffApplyToggle: () => undefined,
			fixJsonToggle: () => undefined,
			quitConfirm: () => undefined,
			clearConfirm: () => undefined,
			notificationsMenu: () => undefined,
		};

		try {
			useAppStore.setState({ modelOverride: "one" });
			const instance = render(
				<ConfigContext.Provider value={multiOpenAiConfig}>
					<React.Profiler
						id="main-menu"
						onRender={(_id, phase) => {
							if (phase === "update") updateCommits += 1;
						}}
					>
						<MainMenu onNavigate={navigation} />
					</React.Profiler>
				</ConfigContext.Provider>,
			);
			await Bun.sleep(1);
			updateCommits = 0;

			useAppStore.setState({ modelOverride: "two" });
			await Bun.sleep(5);

			expect(updateCommits).toBe(0);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState, true);
		}
	});

	test("diff-apply toggle uses latest back callback after rerender", async () => {
		const { DiffApplyToggle } = await import(
			"../../menu/app_menu/autofix-toggles.tsx"
		);
		const calls: string[] = [];
		const enabledConfig = {
			...config,
			diffApply: {
				baseUrl: "https://synthetic.new/v1",
				model: "hf:syntheticlab/diff-apply",
				auth: { type: "env", name: "SYNTHETIC_API_KEY" },
			},
		} as Config;
		const renderMenu = (onBack: () => void) => (
			<ConfigContext.Provider value={enabledConfig}>
				<DiffApplyToggle onBack={onBack} />
			</ConfigContext.Provider>
		);

		const instance = render(renderMenu(() => calls.push("first:back")));
		instance.rerender(renderMenu(() => calls.push("second:back")));
		instance.stdin.write("y");
		await Bun.sleep(0);

		expect(calls).toEqual(["second:back"]);
		instance.unmount();
	});
});
