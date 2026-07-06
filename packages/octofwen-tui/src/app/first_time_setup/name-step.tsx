import { Box, Text } from "ink";
import { useState } from "react";
import { TextInput } from "../../input/text.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { useTerminalThemeColor } from "../../theme/branding.tsx";
import { writeFirstTimeConfig } from "./config-writer.ts";
import type { AutofixConfig } from "./types.ts";

export function NameStep({
	configPath,
	models,
	autofixConfig,
	defaultApiKeyOverrides,
	onDone,
}: {
	configPath: string;
	models: Config["models"];
	autofixConfig?: AutofixConfig;
	defaultApiKeyOverrides: Record<string, string>;
	onDone: () => void;
}) {
	const [yourName, setYourName] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	const themeColor = useTerminalThemeColor();

	return (
		<CenteredBox>
			<Text color={themeColor}>And finally... What's your name?</Text>

			<Box marginTop={1}>
				<Box marginRight={1}>
					<Text>Your name:</Text>
				</Box>
				<TextInput
					value={yourName}
					onChange={(value) => {
						setYourName(value);
						setNameError(null);
					}}
					onSubmit={async () => {
						const trimmedName = yourName.trim();
						if (!trimmedName) {
							setNameError("Name can't be empty");
							return;
						}

						setNameError(null);
						await writeFirstTimeConfig({
							configPath,
							yourName: trimmedName,
							models,
							defaultApiKeyOverrides,
							autofixConfig,
						});
						onDone();
					}}
				/>
			</Box>

			{nameError && (
				<Box marginTop={1}>
					<Text color="red">{nameError}</Text>
				</Box>
			)}
		</CenteredBox>
	);
}
