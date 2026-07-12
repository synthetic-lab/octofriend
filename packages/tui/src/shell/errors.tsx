import {
	AuthErrorScreen,
	PaymentErrorScreen,
	RateLimitErrorScreen,
	RequestErrorScreen,
} from "./error-screens.tsx";
import type { AppModeData } from "./state/types.ts";

export type BottomBarErrorModeData = Extract<
	AppModeData,
	{
		mode:
			| "auth-error"
			| "payment-error"
			| "rate-limit-error"
			| "request-error"
			| "compaction-error";
	}
>;

export function isBottomBarErrorModeData(
	modeData: AppModeData,
): modeData is BottomBarErrorModeData {
	return (
		modeData.mode === "auth-error" ||
		modeData.mode === "payment-error" ||
		modeData.mode === "rate-limit-error" ||
		modeData.mode === "request-error" ||
		modeData.mode === "compaction-error"
	);
}

export function renderBottomBarErrorContent(modeData: BottomBarErrorModeData) {
	if (modeData.mode === "auth-error") {
		return <AuthErrorScreen error={modeData.error} />;
	}
	if (modeData.mode === "payment-error") {
		return <PaymentErrorScreen error={modeData.error} />;
	}
	if (modeData.mode === "rate-limit-error") {
		return <RateLimitErrorScreen error={modeData.error} />;
	}
	if (modeData.mode === "request-error") {
		return (
			<RequestErrorScreen
				mode="request-error"
				contextualMessage="It looks like you've hit a request error!"
				error={modeData.error}
				curlCommand={modeData.curlCommand}
			/>
		);
	}
	if (modeData.mode === "compaction-error") {
		return (
			<RequestErrorScreen
				mode="compaction-error"
				contextualMessage="History compaction failed due to a request error!"
				error={modeData.error}
				curlCommand={modeData.curlCommand}
			/>
		);
	}
	return null;
}
