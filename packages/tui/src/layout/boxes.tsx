import { Box } from "ink";
import type { ReactNode } from "react";

import { useTerminalContentWidth } from "./viewport";

type CenteredBoxProps = {
	children?: ReactNode;
};

export const CenteredBox = ({ children }: CenteredBoxProps) => {
	const width = useTerminalContentWidth();

	return (
		<Box
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
			height="100%"
		>
			<Box flexDirection="column" width={width}>
				{children}
			</Box>
		</Box>
	);
};

export const HeightlessCenteredBox = ({ children }: CenteredBoxProps) => {
	const width = useTerminalContentWidth();

	return (
		<Box flexDirection="column" justifyContent="center" alignItems="center">
			<Box flexDirection="column" width={width}>
				{children}
			</Box>
		</Box>
	);
};
