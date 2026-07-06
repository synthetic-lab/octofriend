import { Box } from "ink";
import type { ReactNode } from "react";

type CenteredBoxProps = {
	children?: ReactNode;
};

export const CenteredBox = ({ children }: CenteredBoxProps) => {
	return (
		<Box
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
			height="100%"
		>
			<Box flexDirection="column" width={80}>
				{children}
			</Box>
		</Box>
	);
};

export const HeightlessCenteredBox = ({ children }: CenteredBoxProps) => {
	return (
		<Box flexDirection="column" justifyContent="center" alignItems="center">
			<Box flexDirection="column" width={80}>
				{children}
			</Box>
		</Box>
	);
};
