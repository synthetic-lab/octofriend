import { Box, Text, useInput } from "ink";
import { recommendedModel } from "../../internal/model-provider-catalog/main.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { MenuHeader } from "../../menu/root.tsx";
import { TERMINAL_THEME_COLOR } from "../../theme/branding.tsx";
export function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
	useInput((_, key) => {
		if (key.return) onContinue();
	});

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
					day-to-day coding model to use with Octo is{" "}
					{recommendedModel("synthetic").nickname}, an open-source coding model
					you can use via Synthetic, a privacy-focused inference company (that
					we run!). You can also add closed-source models from OpenAI and
					Anthropic, like
					{recommendedModel("openai").nickname} and{" "}
					{recommendedModel("anthropic").nickname}.
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
					OpenAI- or Anthropic-compatible API.
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
