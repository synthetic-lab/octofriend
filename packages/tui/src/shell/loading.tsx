import spinners, { type SpinnerName } from "cli-spinners";
import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import stringWidth from "string-width";
import { normalizeRenderedLineBreaks } from "../render/lines.ts";
import { useTerminalThemeColor } from "../theme/branding.tsx";

const LOADING_DOTS = ["", ".", "..", "..."] as const;
const LONGEST_LOADING_DOTS = LOADING_DOTS[LOADING_DOTS.length - 1];
const LOADING_STATUS_INTERVAL_MS = 300;
const LOADING_SPINNER = spinners.binary;
const LOADING_STATUS_FRAME_TICKS = Math.max(
	1,
	Math.round(LOADING_STATUS_INTERVAL_MS / LOADING_SPINNER.interval),
);

export type SpinnerProps = {
	type?: SpinnerName;
};

export function Spinner({ type = "dots" }: SpinnerProps) {
	const [frame, setFrame] = useState(0);
	const spinner = spinners[type];
	const frameIndex = frame % spinner.frames.length;

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

	return <Text>{spinner.frames[frameIndex]}</Text>;
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
	overrideStrings?: readonly string[];
};

function displayWidth(value: string): number {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 || code > 126) return stringWidth(value);
	}
	return value.length;
}

export function longestLoadingStatusWidth(labels: readonly string[]): number {
	let longestLabelWidth = 0;
	for (const label of labels) {
		const labelWidth = displayWidth(label);
		if (longestLabelWidth < labelWidth) {
			longestLabelWidth = labelWidth;
		}
	}
	return longestLabelWidth + LONGEST_LOADING_DOTS.length;
}

export function loadingStatusPaddingLength(
	label: string,
	dots: string,
	statusWidth: number,
): number {
	const paddingLength = statusWidth - displayWidth(label) - dots.length;
	return paddingLength > 0 ? paddingLength : 0;
}

export function loadingStringsOrDefault(
	overrideStrings?: readonly string[],
): readonly string[] {
	if (!(overrideStrings && overrideStrings.length > 0)) {
		return DEFAULT_LOADING_STRINGS;
	}
	let sanitized: string[] | undefined;
	let writeIndex = 0;
	for (const rawLabel of overrideStrings) {
		const label = rawLabel ?? "";
		const trimmed = normalizeRenderedLineBreaks(label.trim());
		if (trimmed.length === 0) {
			sanitized ??= overrideStrings.slice(0, writeIndex);
			continue;
		}
		if (sanitized !== undefined) {
			sanitized[writeIndex] = trimmed;
		} else if (trimmed !== label) {
			sanitized = overrideStrings.slice(0, writeIndex);
			sanitized[writeIndex] = trimmed;
		}
		writeIndex += 1;
	}
	if (sanitized === undefined) return overrideStrings;
	sanitized.length = writeIndex;
	return sanitized.length > 0 ? sanitized : DEFAULT_LOADING_STRINGS;
}

export function Loading({ overrideStrings }: LoadingProps) {
	const [frameTick, setFrameTick] = useState(0);
	const themeColor = useTerminalThemeColor();
	const loadingStrings = useMemo(
		() => loadingStringsOrDefault(overrideStrings),
		[overrideStrings],
	);
	const statusWidth = useMemo(
		() => longestLoadingStatusWidth(loadingStrings),
		[loadingStrings],
	);
	const statusTick = Math.floor(frameTick / LOADING_STATUS_FRAME_TICKS);
	const dotCount = statusTick % LOADING_DOTS.length;
	const dots = LOADING_DOTS[dotCount];
	const labelIndex =
		Math.floor(statusTick / LOADING_DOTS.length) % loadingStrings.length;
	const label = loadingStrings[labelIndex];
	const spinnerFrameIndex = frameTick % LOADING_SPINNER.frames.length;

	useEffect(() => {
		const cycleLength =
			LOADING_DOTS.length * loadingStrings.length * LOADING_STATUS_FRAME_TICKS;
		const timer = setInterval(() => {
			setFrameTick((currentTick) => (currentTick + 1) % cycleLength);
		}, LOADING_SPINNER.interval);

		return () => {
			clearInterval(timer);
		};
	}, [loadingStrings.length]);

	return (
		<Box>
			<Text color="gray">{LOADING_SPINNER.frames[spinnerFrameIndex]}</Text>
			<Text> </Text>
			<Box width={statusWidth}>
				<Text color={themeColor}>{label}</Text>
				<Text>{dots}</Text>
			</Box>
		</Box>
	);
}
