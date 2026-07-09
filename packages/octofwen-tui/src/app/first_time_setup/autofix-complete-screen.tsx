import { Box, Text } from "ink";
import { useCallback } from "react";
import { useLatestInput, useLatestRef } from "../../input/latest_input.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { MenuHeader } from "../../menu/root.tsx";
import { TERMINAL_THEME_COLOR } from "../../theme/branding.tsx";

export function AutofixCompleteScreen({
	onContinue,
}: {
	onContinue: () => void;
}) {
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
			<MenuHeader title="✨ Autofix models enabled!" />

			<Text>
				Your autofix models are now set up and ready to go. These will help
				improve Octo's performance by automatically fixing minor mistakes in
				code diffs and JSON tool calls.
			</Text>

			<Box marginTop={1}>
				<Text>
					Now let's set up your main coding model. This is the LLM that will
					power Octo's code generation, analysis, and conversation capabilities.
				</Text>
			</Box>

			<Box marginTop={2} justifyContent="center">
				<Text color={TERMINAL_THEME_COLOR}>
					Press enter to continue to model setup.
				</Text>
			</Box>
		</CenteredBox>
	);
}
