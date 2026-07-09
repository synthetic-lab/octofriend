import { Box, Text } from "ink";
import type { AuthError } from "../../internal/configuration/schemas.ts";
import { HeightlessCenteredBox } from "../../layout/boxes.tsx";
import { normalizeRenderedLineBreaks } from "../../rendering/line_splitting.ts";

type CommandFailedAuthError = Extract<AuthError, { type: "command_failed" }>;

export function AuthCommandErrorPanel({
	authError,
	isRetrying,
}: {
	authError: CommandFailedAuthError;
	isRetrying: boolean;
}) {
	return (
		<HeightlessCenteredBox>
			<Box flexDirection="column" gap={1}>
				<Box justifyContent="center">
					<Text color="red">Your auth command failed</Text>
				</Box>
				<Box justifyContent="center">
					<Text color="yellow">
						{normalizeRenderedLineBreaks(authError.message)}
					</Text>
				</Box>
				{authError.stderr && (
					<Box justifyContent="center">
						<Text color="gray">
							stderr: {normalizeRenderedLineBreaks(authError.stderr)}
						</Text>
					</Box>
				)}
				<Box justifyContent="center" marginTop={1}>
					<Text dimColor={true}>
						[R]etry | [ESC] to go back{isRetrying ? " (retrying...)" : ""}
					</Text>
				</Box>
			</Box>
		</HeightlessCenteredBox>
	);
}
