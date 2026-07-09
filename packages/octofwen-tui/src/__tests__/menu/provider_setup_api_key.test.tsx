import { describe, expect, it } from "bun:test";
import { expectPresent, waitFor } from "./provider_setup_test_helpers.ts";

describe("provider setup API-key entry", () => {
	it("renders selected provider details for API-key entry when the base URL is overridden", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { SetApiKey } = await import(
			"../../menu/model_setup/set-api-key.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		const instance = render(
			React.createElement(SetApiKey, {
				baseUrl: "http://127.0.0.1:8080/v1",
				provider: expectPresent(PROVIDERS.openai),
				onComplete: () => undefined,
				onCancel: () => undefined,
			}),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Enter your API key for OpenAI");
		expect(frame).toContain("Endpoint: http://127.0.0.1:8080/v1");
		expect(frame).toContain("https://platform.openai.com/api-keys");
		expect(frame).not.toContain(
			"Enter your API key for http://127.0.0.1:8080/v1",
		);
		instance.unmount();
	});

	it("does not duplicate endpoint copy when the provider is the base URL", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { SetApiKey } = await import(
			"../../menu/model_setup/set-api-key.tsx"
		);

		const instance = render(
			React.createElement(SetApiKey, {
				baseUrl: "https://custom.example.test/v1",
				onComplete: () => undefined,
				onCancel: () => undefined,
			}),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain(
			"Enter your API key for https://custom.example.test/v1.",
		);
		expect(frame).not.toContain("Endpoint:");
		instance.unmount();
	});

	it("masks typed API keys in setup output", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { SetApiKey } = await import(
			"../../menu/model_setup/set-api-key.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const secret = "sk-test-secret";

		const instance = render(
			React.createElement(SetApiKey, {
				baseUrl: "https://api.openai.com/v1",
				provider: expectPresent(PROVIDERS.openai),
				onComplete: () => undefined,
				onCancel: () => undefined,
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write(secret);
		await waitFor(() => (instance.lastFrame() ?? "").includes("••••"));

		const frame = instance.lastFrame() ?? "";
		expect(frame).not.toContain(secret);
		expect(frame).toContain("•".repeat(secret.length));
		instance.unmount();
	});

	it("does not cancel API-key entry while saving", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { SetApiKey } = await import(
			"../../menu/model_setup/set-api-key.tsx"
		);
		let cancelCount = 0;
		let completeCount = 0;
		let resolveWrite: (() => void) | undefined;
		const write = new Promise<void>((resolve) => {
			resolveWrite = resolve;
		});

		const instance = render(
			React.createElement(SetApiKey, {
				baseUrl: "https://api.openai.com/v1",
				onComplete: () => {
					completeCount += 1;
				},
				onCancel: () => {
					cancelCount += 1;
				},
				writeKey: () => write,
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("sk-test-secret");
		await waitFor(() => (instance.lastFrame() ?? "").includes("••••"));
		instance.stdin.write("\r");
		await waitFor(() => (instance.lastFrame() ?? "").includes("Saving..."));
		instance.stdin.write("\x1B");
		await Bun.sleep(1);

		expect(cancelCount).toBe(0);
		expect(completeCount).toBe(0);
		resolveWrite?.();
		await waitFor(() => completeCount === 1);
		expect(instance.lastFrame() ?? "").toContain("Saving...");
		expect(cancelCount).toBe(0);
	});

	it("shows the write error when API-key saving throws synchronously", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { API_KEY_WRITE_ERROR, SetApiKey } = await import(
			"../../menu/model_setup/set-api-key.tsx"
		);

		const instance = render(
			React.createElement(SetApiKey, {
				baseUrl: "https://api.openai.com/v1",
				onComplete: () => undefined,
				onCancel: () => undefined,
				writeKey: () => {
					throw new Error("sync write failure");
				},
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("sk-test-secret");
		await waitFor(() => (instance.lastFrame() ?? "").includes("••••"));
		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(API_KEY_WRITE_ERROR),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain(API_KEY_WRITE_ERROR);
		expect(frame).toContain("Set the API key");
		expect(frame).not.toContain("sync write failure");
		instance.unmount();
	});

	it("shows a safe setup error when API-key completion fails", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { API_KEY_COMPLETE_ERROR, SetApiKey } = await import(
			"../../menu/model_setup/set-api-key.tsx"
		);

		const instance = render(
			React.createElement(SetApiKey, {
				baseUrl: "https://api.openai.com/v1",
				onComplete: () => Promise.reject(new Error("route write failed")),
				onCancel: () => undefined,
				writeKey: () => Promise.resolve(),
			}),
		);

		await Bun.sleep(1);
		instance.stdin.write("sk-test-secret");
		await waitFor(() => (instance.lastFrame() ?? "").includes("••••"));
		instance.stdin.write("\r");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(API_KEY_COMPLETE_ERROR),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain(API_KEY_COMPLETE_ERROR);
		expect(frame).not.toContain("route write failed");
		expect(frame).not.toContain("sk-test-secret");
		instance.unmount();
	});
});
