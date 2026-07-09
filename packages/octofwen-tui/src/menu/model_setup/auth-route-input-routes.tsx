import { Box, Text } from "ink";
import { useCallback } from "react";
import { useLatestRef } from "../../input/latest_input.ts";
import { Step } from "./add-model-step.tsx";
import type { FullFlowRouteData } from "./add-model-types.ts";
import {
	envVarExampleForBaseUrl,
	normalizeEnvVarName,
	parseCommandArgs,
	providerForRouteProps,
	secretPathExampleForBaseUrl,
	validateApiKeyEnvVar,
	validateChatGptOAuthEnvVar,
	validateCommandArgs,
} from "./auth-route-input-helpers.ts";
import {
	apiKeyEnvAuth,
	CHATGPT_OAUTH_ENV_VAR,
	chatGptOAuthEnvAuth,
} from "./provider-auth.ts";
import { SetApiKey } from "./set-api-key.tsx";
import { Back, type ToRoute } from "./setup-router.tsx";

type FullFlowToRoute = ToRoute<FullFlowRouteData>;

export function EnvVarRoute({
	to,
	...props
}: FullFlowRouteData["envVar"] & {
	to: Pick<FullFlowToRoute, "authAsk" | "postAuth">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const exampleEnvVar = envVarExampleForBaseUrl(props.baseUrl, props.provider);
	const handleBack = useCallback(() => {
		toRef.current.authAsk(propsRef.current);
	}, [propsRef, toRef]);
	const handleSubmit = useCallback(
		(envVar: string) =>
			toRef.current.postAuth({
				...propsRef.current,
				auth: apiKeyEnvAuth(envVar),
			}),
		[propsRef, toRef],
	);
	const validateEnvVar = useCallback(
		(value: string) => validateApiKeyEnvVar(value, propsRef.current.env),
		[propsRef],
	);
	return (
		<Back go={handleBack}>
			<Step<string>
				title="What environment variable should Octo read to get the API key?"
				prompt="Environment variable name:"
				parse={normalizeEnvVarName}
				validate={validateEnvVar}
				onSubmit={handleSubmit}
			>
				<Box flexDirection="column">
					{props.renderExamples && (
						<Box marginBottom={1}>
							<Text>(For example, {exampleEnvVar})</Text>
						</Box>
					)}
					<Text>
						You can typically find your API key on your account or settings page
						on your inference provider's website.
					</Text>
					{props.renderExamples && (
						<>
							<Text>
								After getting an API key, make sure to export it in your shell;
								for example:
							</Text>
							<Text bold={true}>
								export {exampleEnvVar}="your-api-key-here"
							</Text>
							<Text>
								(If you're running a local LLM, you can use any non-empty env
								var.)
							</Text>
						</>
					)}
				</Box>
			</Step>
		</Back>
	);
}

export function ChatGptOAuthRoute({
	to,
	...props
}: FullFlowRouteData["chatGptOAuth"] & {
	to: Pick<FullFlowToRoute, "authAsk" | "postAuth">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(() => {
		toRef.current.authAsk(propsRef.current);
	}, [propsRef, toRef]);
	const handleSubmit = useCallback(
		(envVar: string) =>
			toRef.current.postAuth({
				...propsRef.current,
				auth: chatGptOAuthEnvAuth(envVar),
			}),
		[propsRef, toRef],
	);
	const validateEnvVar = useCallback(
		(value: string) => validateChatGptOAuthEnvVar(value, propsRef.current.env),
		[propsRef],
	);
	return (
		<Back go={handleBack}>
			<Step<string>
				title="What environment variable contains your ChatGPT OAuth access token?"
				prompt="OAuth token environment variable:"
				defaultValue={CHATGPT_OAUTH_ENV_VAR}
				parse={normalizeEnvVarName}
				validate={validateEnvVar}
				onSubmit={handleSubmit}
			>
				<Box flexDirection="column">
					<Text>
						OpenAI can authenticate with a ChatGPT OAuth access token. Octo will
						read the token from this environment variable and send it as a
						bearer token to the OpenAI-compatible endpoint.
					</Text>
					{props.renderExamples && (
						<>
							<Text>For Codex CLI users, authenticate first:</Text>
							<Text bold={true}>codex login --device-auth</Text>
							<Text>
								Then expose a non-empty OAuth access token as
								{` ${CHATGPT_OAUTH_ENV_VAR} before starting Octo.`}
							</Text>
						</>
					)}
				</Box>
			</Step>
		</Back>
	);
}

export function CommandRoute({
	to,
	...props
}: FullFlowRouteData["command"] & {
	to: Pick<FullFlowToRoute, "authAsk" | "postAuth">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const secretPathExample = secretPathExampleForBaseUrl(
		props.baseUrl,
		props.provider,
	);
	const handleBack = useCallback(() => {
		toRef.current.authAsk(propsRef.current);
	}, [propsRef, toRef]);
	const handleSubmit = useCallback(
		(command: string[]) =>
			toRef.current.postAuth({
				...propsRef.current,
				auth: { type: "command", command },
			}),
		[propsRef, toRef],
	);
	return (
		<Back go={handleBack}>
			<Step<string[]>
				title="What command should Octo run to get the API key?"
				prompt="Command:"
				parse={parseCommandArgs}
				validate={validateCommandArgs}
				onSubmit={handleSubmit}
			>
				<Box flexDirection="column">
					<Text>
						Enter the command and arguments separated by spaces. The command
						should output only the API key to stdout.
					</Text>
					{props.renderExamples && (
						<>
							<Text>Examples:</Text>
							<Text bold={true}>pass show {secretPathExample}/api-key</Text>
							<Text bold={true}>
								op read "op://vault/{secretPathExample}/key"
							</Text>
							<Text bold={true}>gopass show -o {secretPathExample}/key</Text>
						</>
					)}
				</Box>
			</Step>
		</Back>
	);
}

export function ApiKeyRoute({
	to,
	...props
}: FullFlowRouteData["apiKey"] & {
	to: Pick<FullFlowToRoute, "authAsk" | "postAuth">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleComplete = useCallback(() => {
		toRef.current.postAuth(propsRef.current);
	}, [propsRef, toRef]);
	const handleCancel = useCallback(() => {
		toRef.current.authAsk(propsRef.current);
	}, [propsRef, toRef]);
	return (
		<SetApiKey
			baseUrl={props.baseUrl}
			provider={providerForRouteProps(props)}
			onComplete={handleComplete}
			onCancel={handleCancel}
		/>
	);
}
