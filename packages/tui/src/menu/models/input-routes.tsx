import { Box, Text } from "ink";
import { useCallback, useEffect, useState } from "react";
import { useLatestRef } from "../../input/latest-input.ts";
import { SetApiKey } from "./api-key.tsx";
import {
	apiKeyEnvAuth,
	CHATGPT_OAUTH_ENV_VAR,
	chatGptOAuthEnvAuth,
} from "./auth.ts";
import {
	envVarExampleForBaseUrl,
	normalizeEnvVarName,
	parseCommandArgs,
	providerForRouteProps,
	secretPathExampleForBaseUrl,
	validateApiKeyEnvVar,
	validateCommandArgs,
} from "./auth-input.ts";
import { authorizeCodexOAuth, type CodexOAuthStatus } from "./codex-oauth.ts";
import { Back, type ToRoute } from "./router.tsx";
import { Step } from "./step.tsx";
import type { FullFlowRouteData } from "./types.ts";

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
	const toRef = useLatestRef(to);
	const propsRef = useLatestRef(props);
	const [status, setStatus] = useState<CodexOAuthStatus>({ type: "starting" });
	const configuredEnv = props.env ?? process.env;
	const existingEnvVar = configuredEnv[CHATGPT_OAUTH_ENV_VAR]
		? CHATGPT_OAUTH_ENV_VAR
		: configuredEnv.OPENAI_CODEX_ACCESS_TOKEN
			? "OPENAI_CODEX_ACCESS_TOKEN"
			: null;
	useEffect(() => {
		if (existingEnvVar) return;
		const controller = new AbortController();
		authorizeCodexOAuth(setStatus, controller.signal)
			.then(() =>
				toRef.current.postAuth({
					...propsRef.current,
					auth: chatGptOAuthEnvAuth(CHATGPT_OAUTH_ENV_VAR),
				}),
			)
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					setStatus({
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					});
			});
		return () => controller.abort();
	}, [existingEnvVar, propsRef, toRef]);
	if (existingEnvVar) {
		return (
			<Back go={() => toRef.current.authAsk(propsRef.current)}>
				<Step<string>
					title="What environment variable contains your ChatGPT OAuth access token?"
					prompt="OAuth token environment variable:"
					defaultValue={existingEnvVar}
					parse={normalizeEnvVarName}
					validate={() => ({ valid: true as const })}
					onSubmit={(envVar) =>
						toRef.current.postAuth({
							...propsRef.current,
							auth: chatGptOAuthEnvAuth(envVar),
						})
					}
				>
					<Text>Using the existing OAuth token from {existingEnvVar}.</Text>
				</Step>
			</Back>
		);
	}
	return (
		<Back go={() => toRef.current.authAsk(propsRef.current)}>
			<Box flexDirection="column">
				<Text bold={true}>ChatGPT OAuth authorization</Text>
				{status.type === "starting" && (
					<Text>Requesting an authorization code...</Text>
				)}
				{status.type === "waiting" && (
					<>
						<Text>Open {status.url}</Text>
						<Text>Enter code: {status.code}</Text>
						<Text>Waiting for browser authorization...</Text>
					</>
				)}
				{status.type === "error" && <Text color="red">{status.message}</Text>}
			</Box>
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
