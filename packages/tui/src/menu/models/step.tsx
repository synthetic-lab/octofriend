import { Box, Text } from "ink";
import {
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useLatestRef } from "../../input/latest-input.ts";
import { TextInput } from "../../input/text.ts";
import { useTerminalContentWidth } from "../../layout/viewport.tsx";
import { normalizeRenderedLineBreaks } from "../../render/lines.ts";
import { useTerminalThemeColor } from "../../theme/branding.tsx";
import { errorContext } from "./error-context.tsx";
import { nonEmptyTrimmedValue } from "./providers.ts";
import type { AddModelStep } from "./types.ts";

export const STEP_SUBMIT_ERROR = "Setup step failed. Try again.";

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (value !== null && typeof value === "object") ||
		typeof value === "function"
		? typeof (value as { then?: unknown }).then === "function"
		: false;
}

export function Step<T>(props: AddModelStep<T>) {
	const {
		children,
		defaultValue,
		parse,
		prompt,
		title,
		validate,
		onSubmit: submitStep,
	} = props;
	const { errorMessage, setErrorMessage } = useContext(errorContext);
	const defaultText = defaultValue || "";
	const [varValue, setVarValue] = useState(defaultText);
	const [submitting, setSubmitting] = useState(false);
	const mountedRef = useRef(true);
	const dirtyRef = useRef(false);
	const defaultTextRef = useRef(defaultText);
	const submittingRef = useRef(false);
	const valueRef = useLatestRef(varValue);
	const errorMessageRef = useLatestRef(errorMessage);
	const setErrorMessageRef = useLatestRef(setErrorMessage);
	const parseRef = useLatestRef(parse);
	const validateRef = useLatestRef(validate);
	const submitStepRef = useLatestRef(submitStep);
	const themeColor = useTerminalThemeColor();
	const width = useTerminalContentWidth();

	useEffect(() => {
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useLayoutEffect(() => {
		if (defaultTextRef.current === defaultText) return;
		defaultTextRef.current = defaultText;
		if (dirtyRef.current) return;
		valueRef.current = defaultText;
		setVarValue(defaultText);
	}, [defaultText, valueRef]);

	const onValueChange = useCallback((value: string) => {
		dirtyRef.current = true;
		valueRef.current = value;
		if (errorMessageRef.current !== "") setErrorMessageRef.current("");
		setVarValue(value);
	}, []);

	const onSubmit = useCallback(() => {
		if (submittingRef.current) return;
		const trimmed = nonEmptyTrimmedValue(valueRef.current);
		if (trimmed === null) {
			setErrorMessageRef.current("Entry can't be empty");
			return;
		}

		const validationResult = validateRef.current(trimmed);
		if (!validationResult.valid) {
			valueRef.current = "";
			setVarValue("");
			setErrorMessageRef.current(validationResult.error);
			return;
		}

		const parsed = parseRef.current(trimmed);
		let result: unknown;
		try {
			result = submitStepRef.current(parsed);
		} catch {
			setErrorMessageRef.current(STEP_SUBMIT_ERROR);
			return;
		}
		if (isPromiseLike(result)) {
			submittingRef.current = true;
			setSubmitting(true);
			Promise.resolve(result).then(
				() => {
					if (!mountedRef.current) return;
					submittingRef.current = false;
					setSubmitting(false);
				},
				() => {
					if (!mountedRef.current) return;
					submittingRef.current = false;
					setSubmitting(false);
					setErrorMessageRef.current(STEP_SUBMIT_ERROR);
				},
			);
		}
	}, []);

	return (
		<Box
			flexDirection="column"
			justifyContent="center"
			alignItems="center"
			marginTop={1}
		>
			<Box flexDirection="column" width={width} gap={1}>
				<Text color={themeColor}>{normalizeRenderedLineBreaks(title)}</Text>
				{children}
			</Box>

			<Box marginY={1} width={width}>
				<Box marginRight={1}>
					<Text>{normalizeRenderedLineBreaks(prompt)}</Text>
				</Box>

				<TextInput
					value={varValue}
					onChange={onValueChange}
					onSubmit={onSubmit}
				/>
			</Box>

			{submitting && (
				<Box width={width}>
					<Text color="gray">Working...</Text>
				</Box>
			)}

			{errorMessage && (
				<Box width={width}>
					<Text color="red" bold={true}>
						{normalizeRenderedLineBreaks(errorMessage)}
					</Text>
				</Box>
			)}
		</Box>
	);
}
