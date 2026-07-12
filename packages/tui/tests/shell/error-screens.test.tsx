import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	AuthErrorScreen,
	PaymentErrorScreen,
	RateLimitErrorScreen,
	RequestErrorScreen,
} from "../../src/shell/error-screens.tsx";
import { useAppStore } from "../../src/shell/state/store.ts";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("terminal error screens", () => {
	it("exports request, auth, rate-limit, and payment error screens", () => {
		expect(RequestErrorScreen).toBeFunction();
		expect(AuthErrorScreen).toBeFunction();
		expect(RateLimitErrorScreen).toBeFunction();
		expect(PaymentErrorScreen).toBeFunction();
	});

	it("copies request cURL without dumping the whole command into the terminal", async () => {
		const longCurl = `curl https://api.example.test -H '${"x".repeat(200)}'`;
		const writes: string[] = [];
		const { lastFrame, stdin } = render(
			<RequestErrorScreen
				mode="request-error"
				contextualMessage="request failed"
				error="boom"
				curlCommand={longCurl}
				clipboardWriteSync={(text) => {
					writes.push(text);
				}}
			/>,
		);

		stdin.write("c");
		await waitFor(() =>
			(lastFrame() ?? "").includes("cURL command copied to clipboard."),
		);

		expect(writes).toEqual([longCurl]);
		expect(lastFrame()).toContain("cURL command copied to clipboard.");
		expect(lastFrame()).not.toContain(longCurl);
	});

	it("clears copied cURL state when the failed request changes", async () => {
		const firstCurl = "curl https://api.example.test/first";
		const secondCurl = "curl https://api.example.test/second";
		const writes: string[] = [];
		const instance = render(
			<RequestErrorScreen
				mode="request-error"
				contextualMessage="request failed"
				error="boom"
				curlCommand={firstCurl}
				clipboardWriteSync={(text) => {
					writes.push(text);
				}}
			/>,
		);

		instance.stdin.write("c");
		await waitFor(() =>
			(instance.lastFrame() ?? "").includes(
				"cURL command copied to clipboard.",
			),
		);
		expect(instance.lastFrame()).toContain("cURL command copied to clipboard.");

		instance.rerender(
			<RequestErrorScreen
				mode="request-error"
				contextualMessage="request failed again"
				error="boom again"
				curlCommand={secondCurl}
				clipboardWriteSync={(text) => {
					writes.push(text);
				}}
			/>,
		);
		await waitFor(
			() =>
				!(instance.lastFrame() ?? "").includes(
					"cURL command copied to clipboard.",
				),
		);

		expect(writes).toEqual([firstCurl]);
		expect(instance.lastFrame()).toContain("Copy failed request as cURL");
		expect(instance.lastFrame()).not.toContain(
			"cURL command copied to clipboard.",
		);
	});

	it("shows clipboard copy errors without pretending cURL was copied", async () => {
		const { lastFrame, stdin } = render(
			<RequestErrorScreen
				mode="request-error"
				contextualMessage="request failed"
				error="boom"
				curlCommand="curl https://api.example.test"
				clipboardWriteSync={() => {
					throw new Error("clipboard unavailable");
				}}
			/>,
		);

		stdin.write("c");
		await waitFor(() => (lastFrame() ?? "").includes("clipboard unavailable"));

		expect(lastFrame()).toContain("clipboard unavailable");
		expect(lastFrame()).not.toContain("cURL command copied to clipboard.");
	});

	it("normalizes request error line breaks before rendering", async () => {
		const { lastFrame, stdin } = render(
			<RequestErrorScreen
				mode="request-error"
				contextualMessage="request\r\nfailed\ragain"
				error="first\r\nsecond\rthird"
				curlCommand="curl https://api.example.test"
				clipboardWriteSync={() => {
					throw new Error("clipboard\r\nunavailable");
				}}
			/>,
		);

		expect(lastFrame()).toContain("request");
		expect(lastFrame()).toContain("failed");
		expect(lastFrame()).toContain("again");
		expect(lastFrame()).not.toContain("\r");

		stdin.write("v");
		await waitFor(() => (lastFrame() ?? "").includes("third"));
		expect(lastFrame()).toContain("first");
		expect(lastFrame()).toContain("second");
		expect(lastFrame()).toContain("third");
		expect(lastFrame()).not.toContain("\r");

		stdin.write("c");
		await waitFor(() => (lastFrame() ?? "").includes("unavailable"));
		expect(lastFrame()).toContain("clipboard");
		expect(lastFrame()).toContain("unavailable");
		expect(lastFrame()).not.toContain("\r");
	});

	it("renders a dedicated authentication error screen", () => {
		const { lastFrame } = render(<AuthErrorScreen error="invalid api key" />);

		expect(lastFrame()).toContain("Authentication error:");
		expect(lastFrame()).toContain("invalid api key");
		expect(lastFrame()).toContain("Update your API key");
	});

	it("normalizes retry-on-input error line breaks before rendering", () => {
		const { lastFrame } = render(
			<AuthErrorScreen error="invalid\r\napi\rkey" />,
		);

		expect(lastFrame()).toContain("invalid");
		expect(lastFrame()).toContain("api");
		expect(lastFrame()).toContain("key");
		expect(lastFrame()).not.toContain("\r");
	});

	it("renders a dedicated payment error screen", () => {
		const { lastFrame } = render(
			<PaymentErrorScreen error="payment required" />,
		);

		expect(lastFrame()).toContain("Payment error:");
		expect(lastFrame()).toContain("payment required");
		expect(lastFrame()).toContain("Once you've paid");
	});

	it("uses the latest retry action after rerender", async () => {
		const previousState = useAppStore.getState();
		const calls: string[] = [];

		try {
			useAppStore.setState({
				retryFrom: () => {
					calls.push("first");
					return Promise.resolve();
				},
			});
			const instance = render(<AuthErrorScreen error="invalid api key" />);
			useAppStore.setState({
				retryFrom: () => {
					calls.push("second");
					return Promise.resolve();
				},
			});

			await Bun.sleep(1);
			instance.stdin.write("x");
			await Bun.sleep(1);

			expect(calls).toEqual(["second"]);
			instance.unmount();
		} finally {
			useAppStore.setState(previousState);
		}
	});
});
