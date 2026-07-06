import spinners, { type SpinnerName } from "cli-spinners";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { useTerminalThemeColor } from "../theme/branding.tsx";

export type SpinnerProps = {
	type?: SpinnerName;
};

export function Spinner({ type = "dots" }: SpinnerProps) {
	const [frame, setFrame] = useState(0);
	const spinner = spinners[type];

	useEffect(() => {
		const timer = setInterval(() => {
			setFrame((previousFrame) => {
				const isLastFrame = previousFrame === spinner.frames.length - 1;
				return isLastFrame ? 0 : previousFrame + 1;
			});
		}, spinner.interval);

		return () => {
			clearInterval(timer);
		};
	}, [spinner]);

	return <Text>{spinner.frames[frame]}</Text>;
}

export const MemoizedSpinner = React.memo(Spinner);

export const DEFAULT_LOADING_STRINGS = [
	"Scheming",
	"Plotting",
	"Manipulating",
	"Splashing",
	"Yearning",
	"Calculating",
] as const;

export const LONGEST_LOADING_STRING = (() => {
	let longest: string = DEFAULT_LOADING_STRINGS[0];
	for (let i = 1; i < DEFAULT_LOADING_STRINGS.length; i++) {
		const curr = DEFAULT_LOADING_STRINGS[i];
		if (longest.length < curr.length) {
			longest = curr;
		}
	}
	return longest;
})();

export type LoadingProps = {
	overrideStrings?: string[];
};

export function Loading({ overrideStrings }: LoadingProps) {
	const [idx, setIndex] = useState(0);
	const [dotCount, setDotCount] = useState(0);
	const themeColor = useTerminalThemeColor();
	const loadingStrings = overrideStrings || DEFAULT_LOADING_STRINGS;

	useEffect(() => {
		let fired = false;
		const timer = setTimeout(() => {
			fired = true;
			if (dotCount >= 3) {
				setDotCount(0);
				setIndex((idx + 1) % loadingStrings.length);
				return;
			}
			setDotCount(dotCount + 1);
		}, 300);

		return () => {
			if (!fired) clearTimeout(timer);
		};
	}, [idx, dotCount, loadingStrings.length]);

	return (
		<Box>
			<Text color="gray">
				<MemoizedSpinner type="binary" />
			</Text>
			<Text> </Text>
			<Text color={themeColor}>{loadingStrings[idx]}</Text>
			<Text>{".".repeat(dotCount)}</Text>
		</Box>
	);
}
