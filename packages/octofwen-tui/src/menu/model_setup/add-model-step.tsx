import { Box, Text } from "ink";
import { useCallback, useContext, useState } from "react";
import { TextInput } from "../../input/text.ts";
import { useTerminalThemeColor } from "../../theme/branding.tsx";
import { errorContext } from "./add-model-error-context.tsx";
import type { AddModelStep } from "./add-model-types.ts";

export function Step<T>(props: AddModelStep<T>) {
	const { errorMessage, setErrorMessage } = useContext(errorContext);
	const [varValue, setVarValue] = useState(props.defaultValue || "");
	const themeColor = useTerminalThemeColor();

	const onValueChange = useCallback((value: string) => {
		setErrorMessage("");
		setVarValue(value);
	}, []);

	const onSubmit = useCallback(() => {
		const trimmed = varValue.trim();
		if (trimmed === "") {
			setErrorMessage("Entry can't be empty");
			return;
		}

		const validationResult = props.validate(trimmed);
		if (!validationResult.valid) {
			setVarValue("");
			setErrorMessage(validationResult.error);
			return;
		}

		const parsed = props.parse(trimmed);
		props.onSubmit(parsed);
	}, [props, varValue]);

	return (
		<Box
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
			marginTop={1}
		>
			<Box flexDirection="column" width={80} gap={1}>
				<Text color={themeColor}>{props.title}</Text>
				{props.children}
			</Box>

			<Box marginY={1} width={80}>
				<Box marginRight={1}>
					<Text>{props.prompt}</Text>
				</Box>

				<TextInput
					value={varValue}
					onChange={onValueChange}
					onSubmit={onSubmit}
				/>
			</Box>

			{errorMessage && (
				<Box width={80}>
					<Text color="red" bold={true}>
						{errorMessage}
					</Text>
				</Box>
			)}
		</Box>
	);
}
