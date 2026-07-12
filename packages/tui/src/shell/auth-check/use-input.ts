import { type Dispatch, type SetStateAction, useCallback } from "react";
import { type InkInputKey, useLatestInput } from "../../input/latest-input.ts";
import type { AuthError } from "../../runtime/config/schemas.ts";
import { errorToString } from "../result.ts";

export function useAuthPreflightInput({
	authError,
	exit,
	isRetrying,
	setAuthError,
	setExitMessage,
	setIsRetrying,
	validateAuth,
}: {
	authError: AuthError | null;
	exit: () => void;
	isRetrying: boolean;
	setAuthError: Dispatch<SetStateAction<AuthError | null>>;
	setExitMessage: Dispatch<SetStateAction<string | null>>;
	setIsRetrying: Dispatch<SetStateAction<boolean>>;
	validateAuth: () => Promise<boolean>;
}) {
	const onInput = useCallback(
		async (input: string, key: InkInputKey) => {
			if (key.escape && authError) {
				setAuthError(null);
				setIsRetrying(false);
				return;
			}

			if (
				input === "r" &&
				authError?.type === "command_failed" &&
				!isRetrying
			) {
				setIsRetrying(true);
				try {
					const valid = await validateAuth();
					if (valid) exit();
				} catch (error) {
					setIsRetrying(false);
					setExitMessage(`Retry failed: ${errorToString(error)}`);
				}
				return;
			}

			if (!key.escape) setExitMessage(null);
		},
		[
			authError,
			exit,
			isRetrying,
			setAuthError,
			setExitMessage,
			setIsRetrying,
			validateAuth,
		],
	);

	useLatestInput(onInput);
}
