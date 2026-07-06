import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import React from "react";
import {
	AuthErrorScreen,
	PaymentErrorScreen,
	RateLimitErrorScreen,
	RequestErrorScreen,
} from "../../app/error_screens.tsx";

describe("terminal error screens", () => {
	it("exports request, auth, rate-limit, and payment error screens", () => {
		expect(RequestErrorScreen).toBeFunction();
		expect(AuthErrorScreen).toBeFunction();
		expect(RateLimitErrorScreen).toBeFunction();
		expect(PaymentErrorScreen).toBeFunction();
	});

	it("renders a dedicated authentication error screen", () => {
		const { lastFrame } = render(<AuthErrorScreen error="invalid api key" />);

		expect(lastFrame()).toContain("Authentication error:");
		expect(lastFrame()).toContain("invalid api key");
		expect(lastFrame()).toContain("Update your API key");
	});

	it("renders a dedicated payment error screen", () => {
		const { lastFrame } = render(
			<PaymentErrorScreen error="payment required" />,
		);

		expect(lastFrame()).toContain("Payment error:");
		expect(lastFrame()).toContain("payment required");
		expect(lastFrame()).toContain("Once you've paid");
	});
});
