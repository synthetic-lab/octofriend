import { Text } from "ink";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useLatestRef } from "../../input/latest_input.ts";
import { type Item, KbShortcutPanel } from "../../input/shortcuts.tsx";
import { providerForBaseUrl } from "../../internal/model-provider-catalog/main.ts";
import { normalizeRenderedLineBreaks } from "../../rendering/line_splitting.ts";
import { errorContext } from "./add-model-error-context.tsx";
import type { FullFlowRouteData, Transitions } from "./add-model-types.ts";
import {
	type AuthChoiceRoute,
	authPromptText,
	authShortcutItemsForSupport,
	authSupportDetailText,
} from "./auth-route-options.ts";
import { authChoicesForProvider } from "./provider-auth.ts";
import { resolveProviderEnvVar } from "./provider-helpers.ts";
import { Back } from "./setup-router.tsx";

export type { AuthChoiceRoute } from "./auth-route-options.ts";

export function AuthAsk(
	props: FullFlowRouteData["authAsk"] &
		Pick<Transitions<void>, "back"> & {
			onSelect: (route: AuthChoiceRoute) => void;
		},
) {
	const provider = useMemo(
		() => props.provider ?? providerForBaseUrl(props.baseUrl) ?? undefined,
		[props.provider, props.baseUrl],
	);
	const { errorMessage } = useContext(errorContext);
	const { supportsApiKey, supportsChatGptOAuth } = useMemo(
		() =>
			provider === undefined
				? { supportsApiKey: true, supportsChatGptOAuth: false }
				: authChoicesForProvider(provider),
		[provider],
	);
	const hasSupportedAuth = supportsApiKey || supportsChatGptOAuth;
	const apiKeyEnvVar = useMemo(
		() =>
			provider && supportsApiKey
				? resolveProviderEnvVar(provider, props.config, null)
				: undefined,
		[provider, props.config, supportsApiKey],
	);
	const promptText = useMemo(() => {
		if (!provider) return null;
		const authText = authPromptText(
			provider,
			supportsApiKey,
			supportsChatGptOAuth,
			apiKeyEnvVar ?? provider.envVar,
		);
		return hasSupportedAuth
			? `${authText} How do you want to authenticate with ${provider.name}?`
			: `${authText} Press Back and choose another provider or edit the catalog.`;
	}, [
		apiKeyEnvVar,
		hasSupportedAuth,
		provider,
		supportsApiKey,
		supportsChatGptOAuth,
	]);
	const backRef = useLatestRef(props.back);
	const routeSelectRef = useLatestRef(props.onSelect);
	const shortcutItems = useMemo(
		() =>
			authShortcutItemsForSupport(
				supportsApiKey,
				supportsChatGptOAuth,
				provider,
				apiKeyEnvVar,
			),
		[supportsApiKey, supportsChatGptOAuth, provider, apiKeyEnvVar],
	);
	const onSelect = useCallback(
		(item: Item<AuthChoiceRoute | "back">) => {
			if (item.value === "back") backRef.current();
			else routeSelectRef.current(item.value);
		},
		[backRef, routeSelectRef],
	);
	const handleBack = useCallback(() => backRef.current(), [backRef]);

	return (
		<Back go={handleBack}>
			<KbShortcutPanel
				title={
					hasSupportedAuth
						? "How do you want to authenticate?"
						: "No supported authentication methods"
				}
				shortcutItems={shortcutItems}
				onSelect={onSelect}
			>
				{errorMessage && (
					<Text color="red" bold={true}>
						{normalizeRenderedLineBreaks(errorMessage)}
					</Text>
				)}
				{provider ? (
					<Text>{normalizeRenderedLineBreaks(promptText ?? "")}</Text>
				) : (
					<Text>
						This custom endpoint can use an API key, an existing environment
						variable, or a secret command. Choose the source Octofwen should use
						for this model.
					</Text>
				)}
				{supportsChatGptOAuth && (
					<Text color="gray">
						{normalizeRenderedLineBreaks(
							authSupportDetailText(
								provider?.name ?? "This provider",
								supportsApiKey,
							),
						)}
					</Text>
				)}
				{!(supportsApiKey || supportsChatGptOAuth) && (
					<Text color="red">
						This provider does not advertise API-key authentication in the
						catalog.
					</Text>
				)}
			</KbShortcutPanel>
		</Back>
	);
}

export function PostAuth(
	props: FullFlowRouteData["postAuth"] & {
		handleAuth: () => void;
	},
) {
	const handledRef = useRef(false);
	useEffect(() => {
		if (handledRef.current) return;
		handledRef.current = true;
		props.handleAuth();
	}, [props.handleAuth]);
	return null;
}
