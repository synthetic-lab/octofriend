import { Box, Text } from "ink";
import { useCallback } from "react";
import { useLatestInput, useLatestRef } from "../../input/latest-input";
import { recommendedModel } from "../../runtime/models/catalog/main";
import { CenteredBox } from "../../layout/boxes";
import { MenuHeader } from "../../menu/root";
import { TERMINAL_THEME_COLOR } from "../../theme/branding";

const SYNTHETIC_MODEL = recommendedModel("synthetic")?.nickname ?? "Synthetic";
const CLOSED_SOURCE_TEXT = closedSourceSetupText();

function closedSourceSetupText(): string | null {
	let examples = "";
	for (const provider of ["openai", "anthropic", "gemini"] as const) {
		const nickname = recommendedModel(provider)?.nickname;
		if (nickname === undefined) continue;
		examples = examples.length === 0 ? nickname : `${examples}, ${nickname}`;
	}
	return examples.length === 0
		? null
		: ` You can also add closed-source models from OpenAI, Anthropic, and Gemini, like ${examples}.`;
}

export function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
	const onContinueRef = useLatestRef(onContinue);
	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.return) onContinueRef.current();
			},
			[onContinueRef],
		),
	);

	return (
		<CenteredBox>
			<MenuHeader title="Welcome to Octo!" />

			<Text>
				You don't seem to have a config file, so let's set you up for the first
				time.
			</Text>

			<Box marginTop={1}>
				<Text>
					Octo lets you choose the LLM that powers it. Currently our recommended
					day-to-day coding model to use with Octo is {SYNTHETIC_MODEL}, an
					open-source coding model you can use via Synthetic, a privacy-focused
					inference company (that we run!).{CLOSED_SOURCE_TEXT}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color="gray">
					Be forewarned about using OpenRouter for open-source models:
					OpenRouter doesn't test model implementations, and quality can vary
					drastically. Many are broken. We'd strongly recommend using Synthetic
					instead.
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text>
					You can add multiple models via Octo's menu: Octo lets you switch
					models mid-conversation as needed to handle different problems. It's
					often helpful to add a couple of strong models; if one gets stuck,
					another may often be able to solve your problem. Octo works with any
					OpenAI-, Anthropic-, Gemini-, or Synthetic-compatible API.
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text>
					OpenAI setup supports ChatGPT OAuth or an API key. Anthropic, Gemini,
					and Synthetic setup use API keys.
				</Text>
			</Box>

			<Box marginTop={2} justifyContent="center">
				<Text color={TERMINAL_THEME_COLOR}>
					Press enter when you're ready to begin setup.
				</Text>
			</Box>
		</CenteredBox>
	);
}
