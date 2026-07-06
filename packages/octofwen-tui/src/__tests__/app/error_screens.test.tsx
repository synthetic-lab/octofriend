import { describe, expect, it } from "bun:test";
import {
	PaymentErrorScreen,
	RateLimitErrorScreen,
	RequestErrorScreen,
} from "../../app/error_screens.tsx";

describe("terminal error screens", () => {
	it("exports request, rate-limit, and payment error screens", () => {
		expect(RequestErrorScreen).toBeFunction();
		expect(RateLimitErrorScreen).toBeFunction();
		expect(PaymentErrorScreen).toBeFunction();
	});
});
