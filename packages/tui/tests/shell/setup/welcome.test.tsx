import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import { AutofixCompleteScreen } from "../../../src/shell/setup/autofix-complete";
import { WelcomeScreen } from "../../../src/shell/setup/welcome";

describe("first-time setup welcome screen", () => {
	test("explains Gemini-compatible setup support", () => {
		const instance = render(
			React.createElement(WelcomeScreen, { onContinue: () => undefined }),
		);

		const frame = (instance.lastFrame() ?? "").replace(/\s+/g, " ");

		expect(frame).toContain(
			"OpenAI-, Anthropic-, Gemini-, or Synthetic-compatible API",
		);
		expect(frame).toContain(
			"OpenAI setup supports ChatGPT OAuth or an API key",
		);
		expect(frame).toContain(
			"Anthropic, Gemini, and Synthetic setup use API keys",
		);
		expect(frame).toContain("OpenAI, Anthropic, and Gemini");
	});

	test("uses latest welcome continue callback after rerender", async () => {
		const calls: string[] = [];
		const instance = render(
			<WelcomeScreen onContinue={() => calls.push("first:continue")} />,
		);
		instance.rerender(
			<WelcomeScreen onContinue={() => calls.push("second:continue")} />,
		);

		instance.stdin.write("\r");
		await Bun.sleep(0);

		expect(calls).toEqual(["second:continue"]);
		instance.unmount();
	});

	test("uses latest autofix complete continue callback after rerender", async () => {
		const calls: string[] = [];
		const instance = render(
			<AutofixCompleteScreen onContinue={() => calls.push("first:continue")} />,
		);
		instance.rerender(
			<AutofixCompleteScreen
				onContinue={() => calls.push("second:continue")}
			/>,
		);

		instance.stdin.write("\r");
		await Bun.sleep(0);

		expect(calls).toEqual(["second:continue"]);
		instance.unmount();
	});
});
