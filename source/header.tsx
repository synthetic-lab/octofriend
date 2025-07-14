import React from "react";
import figlet from "figlet";
import { Box, Text } from "ink";
import { useColor, useUnchained } from "./theme.ts";

export const Header = React.memo(() => {
	const font: figlet.Fonts = "Delta Corps Priest 1";
	const top = figlet.textSync("Octo", font);
	const bottom = figlet.textSync("Friend", font);
  const themeColor = useColor();
  const unchained = useUnchained();

	return <Box flexDirection="column">
		<Text color={themeColor}>{top}</Text>
		<Text>{bottom}</Text>
    { unchained && <Text>Unchained mode activated!</Text> }
	</Box>
});
