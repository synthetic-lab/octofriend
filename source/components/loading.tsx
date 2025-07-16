import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useColor } from "../theme.ts";

const LOADING_STRINGS = [
	"Scheming",
	"Plotting",
	"Manipulating",
	"Splashing",
	"Yearning",
	"Calculating",
];
export default function Loading() {
	const [ idx, setIndex ] = useState(0);
	const [ dotCount, setDotCount ] = useState(0);
  const themeColor = useColor();

	useEffect(() => {
		let fired = false;
		const timer = setTimeout(() => {
			fired = true;
			if(dotCount >= 3) {
				setDotCount(0);
				setIndex((idx + 1) % LOADING_STRINGS.length);
				return;
			}
			setDotCount(dotCount + 1);
		}, 300);

		return () => {
			if(!fired) clearTimeout(timer);
		}
	}, [ idx, dotCount ]);

	return <Box>
		<Text color="gray"><Spinner type="binary" /></Text>
		<Text>{ " " }</Text>
		<Text color={themeColor}>
      {LOADING_STRINGS[idx]}</Text><Text>{".".repeat(dotCount)}
    </Text>
	</Box>
}
