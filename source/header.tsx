import React from "react";
import figlet from "figlet";
import { Box, Text } from "ink";
import { THEME_COLOR } from "./theme.ts";

export const Header = React.memo(() => {
	const font: figlet.Fonts = "Delta Corps Priest 1";
	const top = figlet.textSync("Octo", font);
	const bottom = figlet.textSync("Friend", font);

	return <Box flexDirection="column">
		<Text color={THEME_COLOR}>{top}</Text>
		<Text>{bottom}</Text>
	</Box>
});
