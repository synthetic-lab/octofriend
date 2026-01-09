import React from "react";
import figlet from "figlet";
import { Box, Text } from "ink";
import { color } from "./theme.ts";

type HeaderProps = {
  unchained: boolean;
};

export const Header = React.memo(({ unchained }: HeaderProps) => {
	const font: figlet.Fonts = "Delta Corps Priest 1";
	const top = figlet.textSync("Octo", { font });
	const bottom = figlet.textSync("Friend", { font });
  const themeColor = color(unchained);

	return <Box flexDirection="column">
		<Text color={themeColor}>{top}</Text>
		<Text>{bottom}</Text>
	</Box>
});
