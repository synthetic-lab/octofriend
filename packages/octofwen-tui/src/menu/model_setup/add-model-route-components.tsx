import { Box, Text } from "ink";
import { useCallback, useContext, useEffect } from "react";
import {
	type Item,
	KbShortcutPanel,
	type ShortcutArray,
} from "../../input/shortcuts.tsx";
import { PROVIDERS } from "../../internal/model-provider-catalog/main.ts";
import { useTerminalThemeColor } from "../../theme/branding.tsx";
import {
	testConnection,
	useModelConnectionTest,
} from "./add-model-connection.ts";
import { errorContext } from "./add-model-error-context.tsx";
import { Step } from "./add-model-step.tsx";
import type {
	FullFlowRouteData,
	ModelMetadata,
	Transitions,
} from "./add-model-types.ts";
import { Back } from "./primitives.tsx";

const K_FORMAT_NUMBER = /^\d+$/;

export function AuthAsk(
	props: FullFlowRouteData["authAsk"] &
		Pick<Transitions<void>, "back"> & {
			onSelect: (route: "apiKey" | "envVar" | "command") => void;
		},
) {
	const provider = Object.values(PROVIDERS).find((provider) => {
		return provider.baseUrl === props.baseUrl;
	});

	const shortcutItems = [
		{
			type: "key" as const,
			mapping: {
				a: {
					label: "Enter an API key",
					value: "apiKey",
				},
				e: {
					label: "I have an existing environment variable I use...",
					value: "envVar",
				},
				c: {
					label: "Use a command (e.g. pass, op, gopass)...",
					value: "command",
				},
				b: {
					label: "Back",
					value: "back",
				},
			} as const,
		},
	] satisfies ShortcutArray<"apiKey" | "envVar" | "command" | "back">;
	const onSelect = useCallback(
		(item: Item<"apiKey" | "envVar" | "command" | "back">) => {
			if (item.value === "back") props.back();
			else props.onSelect(item.value);
		},
		[],
	);

	return (
		<Back go={props.back}>
			<KbShortcutPanel
				title="How do you want to authenticate?"
				shortcutItems={shortcutItems}
				onSelect={onSelect}
			>
				{provider && (
					<Text>
						It looks like you don't have the default {provider.envVar}{" "}
						environment variable defined in your current shell. How do you want
						to authenticate with {provider.name}?
					</Text>
				)}
			</KbShortcutPanel>
		</Back>
	);
}

export function PostAuth(
	props: FullFlowRouteData["postAuth"] & {
		handleAuth: () => void;
	},
) {
	useEffect(() => {
		props.handleAuth();
	}, []);
	return null;
}

export function Model(props: FullFlowRouteData["model"] & Transitions<string>) {
	return (
		<Back go={props.back}>
			<Step<string>
				title="What's the model string for the API you're using?"
				prompt="Model string:"
				parse={(val) => val}
				validate={(val) => {
					if (props.baseUrl === "https://synthetic.new") {
						if (!val.startsWith("hf:")) {
							return {
								valid: false,
								error: `Synthetic model names need to be prefixed with "hf:" (without the quotes)`,
							};
						}
					}
					return { valid: true };
				}}
				onSubmit={props.onSubmit}
			>
				{props.renderExamples && (
					<Box marginBottom={1}>
						<Text>
							(For example, to use Kimi K2 with the Moonshot API, you would use
							kimi-k2-0711-preview)
						</Text>
					</Box>
				)}
				<Text>
					This varies by inference provider: you can typically find this
					information in your inference provider's documentation.
				</Text>
			</Step>
		</Back>
	);
}

export function TestConnection(
	props: FullFlowRouteData["testConnection"] & {
		errorNav: () => unknown;
	} & Transitions<ModelMetadata>,
) {
	const { setErrorMessage } = useContext(errorContext);
	const modelConnectionTest = useModelConnectionTest();
	useEffect(() => {
		testConnection({
			model: props.model,
			auth: props.auth,
			baseUrl: props.baseUrl,
			config: props.config,
			modelConnectionTest,
		}).then((result) => {
			if (result.valid) {
				props.onSubmit(result.metadata);
				return;
			}
			setErrorMessage(result.errorMessage ?? "Connection failed.");
			props.errorNav();
		});
	}, [props, modelConnectionTest]);

	return (
		<Back go={props.back}>
			<Box
				flexDirection="column"
				justifyContent="center"
				alignItems="center"
				marginTop={1}
			>
				<Box flexDirection="column" width={80}>
					<Text color="yellow" bold={true}>
						Testing connection...
					</Text>
				</Box>
			</Box>
		</Back>
	);
}

export function formatContextTokens(tokens: number): string {
	const halfTokens = tokens / 2;
	const kValue = Math.round(halfTokens / 1024);
	return `${kValue}k`;
}

export function Context(
	props: FullFlowRouteData["context"] & Pick<Transitions<number>, "back">,
) {
	const color = useTerminalThemeColor();
	const { baseUrl, auth, model, nickname, done, metadata } = props;
	const defaultContext = metadata.contextLength
		? formatContextTokens(metadata.contextLength)
		: "";
	return (
		<Back go={props.back}>
			<Step<number>
				title="What's the maximum number of tokens Octo should use per request?"
				prompt="Maximum tokens:"
				defaultValue={defaultContext}
				parse={(val) => {
					return Number.parseInt(val.replace("k", ""), 10) * 1024;
				}}
				validate={(value) => {
					if (K_FORMAT_NUMBER.test(value.replace("k", "")))
						return { valid: true };
					return {
						valid: false,
						error: "Couldn't parse your input as a number: please try again",
					};
				}}
				onSubmit={(context) =>
					done({
						baseUrl,
						model,
						nickname,
						context,
						auth,
					})
				}
			>
				<Box flexDirection="column">
					<Text>
						You can usually find this information in the documentation for the
						model on your inference company's website.
					</Text>
					<Box marginY={1}>
						<Text>
							(This is an estimate: leave some buffer room. Best performance is
							often at half the number of tokens supported by the API.)
						</Text>
					</Box>
					<Text>
						Format the number in k: for example, <Text color={color}>32k</Text>{" "}
						or, <Text color={color}>64k</Text>.
					</Text>
				</Box>
			</Step>
		</Back>
	);
}
