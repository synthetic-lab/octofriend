import { Box, Text } from "ink";
import { useCallback } from "react";
import { useLatestRef } from "../../input/latest_input.ts";
import { hasExistingKeyForBaseUrl } from "../../internal/configuration/keys.ts";
import { Step } from "./add-model-step.tsx";
import type { FullFlowRouteData } from "./add-model-types.ts";
import { nonEmptyTrimmedValue } from "./provider-helpers.ts";
import { Back, router, type ToRoute } from "./setup-router.tsx";

export const fullFlow = router<FullFlowRouteData>();
type FullFlowToRoute = ToRoute<FullFlowRouteData>;

function parseBaseUrlInput(value: string): string {
	return nonEmptyTrimmedValue(value) ?? "";
}

function validateBaseUrlInput(value: string) {
	return nonEmptyTrimmedValue(value) === null
		? { valid: false as const, error: "Base URL can't be empty" }
		: { valid: true as const };
}

function parseNicknameInput(value: string): string {
	return value;
}

function validateNicknameInput() {
	return { valid: true as const };
}

export function defaultNicknameFromModelName(name: string | undefined): string {
	if (name === undefined) return "";
	const segmentStart = name.lastIndexOf("/") + 1;
	if (segmentStart >= name.length) return "";
	const segment = segmentStart === 0 ? name : name.slice(segmentStart);
	return replaceHyphensWithSpaces(segment);
}

function replaceHyphensWithSpaces(value: string): string {
	const firstHyphen = value.indexOf("-");
	if (firstHyphen === -1) return value;
	const parts: string[] = [];
	let copyStart = 0;
	for (let index = firstHyphen; index < value.length; index += 1) {
		if (value.charCodeAt(index) !== 45) continue;
		if (copyStart < index) parts[parts.length] = value.slice(copyStart, index);
		parts[parts.length] = " ";
		copyStart = index + 1;
	}
	if (copyStart < value.length) parts[parts.length] = value.slice(copyStart);
	return parts.join("");
}

function BaseUrlRoute({
	to,
	...props
}: FullFlowRouteData["baseUrl"] & {
	to: Pick<FullFlowToRoute, "authAsk" | "postAuth">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleSubmit = useCallback(
		async (baseUrl: string) => {
			const props = propsRef.current;
			const hasExistingKey = await hasExistingKeyForBaseUrl(
				baseUrl,
				props.config,
			);
			if (hasExistingKey) {
				toRef.current.postAuth({ ...props, baseUrl });
			} else {
				toRef.current.authAsk({ ...props, baseUrl });
			}
		},
		[propsRef, toRef],
	);
	return (
		<Back go={props.cancel}>
			<Step<string>
				title="What's the base URL for the API you're connecting to?"
				prompt="Base URL:"
				parse={parseBaseUrlInput}
				validate={validateBaseUrlInput}
				onSubmit={handleSubmit}
			>
				<Box flexDirection="column">
					{props.renderExamples && (
						<Box marginBottom={1}>
							<Text>
								(For example, for Moonshot's Kimi K2 API,
								https://api.moonshot.ai/v1)
							</Text>
						</Box>
					)}
					<Text>
						You can usually find this information in your inference provider's
						documentation.
					</Text>
				</Box>
			</Step>
		</Back>
	);
}

function NicknameRoute({
	to,
	...props
}: FullFlowRouteData["nickname"] & {
	to: Pick<FullFlowToRoute, "context" | "model">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const defaultNickname =
		props.nickname || defaultNicknameFromModelName(props.metadata.name);
	const handleBack = useCallback(
		() => toRef.current.model(propsRef.current),
		[propsRef, toRef],
	);
	const handleSubmit = useCallback(
		(nickname: string) =>
			toRef.current.context({ ...propsRef.current, nickname }),
		[propsRef, toRef],
	);
	return (
		<Back go={handleBack}>
			<Step<string>
				title="Let's give this model a nickname so we can easily reference it later."
				prompt="Nickname:"
				defaultValue={defaultNickname}
				parse={parseNicknameInput}
				validate={validateNicknameInput}
				onSubmit={handleSubmit}
			>
				<Box flexDirection="column">
					{props.renderExamples && (
						<Text>
							For example, if this was set up to talk to Kimi K2, you might want
							to call it that.
						</Text>
					)}
				</Box>
			</Step>
		</Back>
	);
}

export const baseUrl = fullFlow
	.withRoutes("authAsk", "baseUrl", "postAuth")
	.build("baseUrl", (to) => (props) => <BaseUrlRoute {...props} to={to} />);

export const nickname = fullFlow
	.withRoutes("nickname", "model", "context")
	.build("nickname", (to) => (props) => <NicknameRoute {...props} to={to} />);
