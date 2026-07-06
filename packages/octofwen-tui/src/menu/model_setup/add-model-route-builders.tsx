import { Box, Text } from "ink";
import { parse } from "shell-quote";
import { hasExistingKeyForBaseUrl } from "../../internal/configuration/keys.ts";
import { Step } from "./add-model-step.tsx";
import type { FullFlowRouteData } from "./add-model-types.ts";
import { Back, router, SetApiKey } from "./primitives.tsx";

export const fullFlow = router<FullFlowRouteData>();

export const baseUrl = fullFlow
	.withRoutes("authAsk", "baseUrl", "postAuth")
	.build("baseUrl", (to) => (props) => {
		return (
			<Back go={props.cancel}>
				<Step<string>
					title="What's the base URL for the API you're connecting to?"
					prompt="Base URL:"
					parse={(val) => val}
					validate={() => ({ valid: true })}
					onSubmit={async (baseUrl) => {
						const hasExistingKey = await hasExistingKeyForBaseUrl(
							baseUrl,
							props.config,
						);
						if (hasExistingKey) {
							to.postAuth({ ...props, baseUrl });
						} else {
							to.authAsk({ ...props, baseUrl });
						}
					}}
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
	});

export const envVar = fullFlow
	.withRoutes("authAsk", "envVar", "postAuth")
	.build("envVar", (to) => (props) => {
		return (
			<Back go={() => to.authAsk(props)}>
				<Step<string>
					title="What environment variable should Octo read to get the API key?"
					prompt="Environment variable name:"
					parse={(val) => val}
					validate={(val) => {
						if (process.env[val]) return { valid: true };

						return {
							valid: false,
							error: `
Env var ${val} isn't defined in your current shell. Do you need to re-source your .bashrc or .zshrc?
          `.trim(),
						};
					}}
					onSubmit={(envVar) =>
						to.postAuth({ ...props, auth: { type: "env", name: envVar } })
					}
				>
					<Box flexDirection="column">
						{props.renderExamples && (
							<Box marginBottom={1}>
								<Text>(For example, MOONSHOT_API_KEY)</Text>
							</Box>
						)}
						<Text>
							You can typically find your API key on your account or settings
							page on your inference provider's website.
						</Text>
						{props.renderExamples && (
							<>
								<Text>
									After getting an API key, make sure to export it in your
									shell; for example:
								</Text>
								<Text bold={true}>
									export MOONSHOT_API_KEY="your-api-key-here"
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
	});

export const command = fullFlow
	.withRoutes("authAsk", "command", "postAuth")
	.build("command", (to) => (props) => {
		return (
			<Back go={() => to.authAsk(props)}>
				<Step<string[]>
					title="What command should Octo run to get the API key?"
					prompt="Command:"
					parse={(val) => {
						const parsed = parse(val);
						// shell-quote returns an array that may include shell operators (objects)
						// We filter to keep only string arguments for the command
						return parsed.filter(
							(item): item is string => typeof item === "string",
						);
					}}
					validate={(val) => {
						const parsed = parse(val);

						// Detect shell operators (pipes, redirects, etc.) which shell-quote parses as objects
						const hasOperators = parsed.some(
							(item) => typeof item !== "string",
						);
						if (hasOperators) {
							return {
								valid: false,
								error:
									"Shell operators like pipes (|) and redirects (>, <) aren't supported. Enter only the command and its arguments.",
							};
						}

						const [commandName] = parsed;
						if (!commandName) {
							return { valid: false, error: "Command can't be empty" };
						}
						return { valid: true };
					}}
					onSubmit={(command) =>
						to.postAuth({ ...props, auth: { type: "command", command } })
					}
				>
					<Box flexDirection="column">
						<Text>
							Enter the command and arguments separated by spaces. The command
							should output only the API key to stdout.
						</Text>
						{props.renderExamples && (
							<>
								<Text>Examples:</Text>
								<Text bold={true}>pass show openai/api-key</Text>
								<Text bold={true}>op read "op://vault/openai/key"</Text>
								<Text bold={true}>gopass show -o openai/key</Text>
							</>
						)}
					</Box>
				</Step>
			</Back>
		);
	});

export const apiKey = fullFlow
	.withRoutes("apiKey", "authAsk", "postAuth")
	.build("apiKey", (to) => (props) => {
		return (
			<SetApiKey
				baseUrl={props.baseUrl}
				onComplete={() => to.postAuth(props)}
				onCancel={() => to.authAsk(props)}
			/>
		);
	});

export const nickname = fullFlow
	.withRoutes("nickname", "model", "context")
	.build("nickname", (router) => (props) => {
		const defaultNickname =
			props.nickname ||
			props.metadata.name?.split("/").pop()?.replace(/-/g, " ") ||
			"";
		return (
			<Back go={() => router.model(props)}>
				<Step<string>
					title="Let's give this model a nickname so we can easily reference it later."
					prompt="Nickname:"
					defaultValue={defaultNickname}
					parse={(val) => val}
					validate={() => ({ valid: true })}
					onSubmit={(nickname) => router.context({ ...props, nickname })}
				>
					<Box flexDirection="column">
						{props.renderExamples && (
							<Text>
								For example, if this was set up to talk to Kimi K2, you might
								want to call it that.
							</Text>
						)}
					</Box>
				</Step>
			</Back>
		);
	});
