import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { errorToString } from "../../app/result.ts";
import { useLatestInput, useLatestRef } from "../../input/latest_input.ts";
import {
	hasExistingKeyForBaseUrl,
	hasExistingKeyForModel,
} from "../../internal/configuration/keys.ts";
import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import type { ProviderConfig } from "../../internal/model-provider-catalog/main.ts";
import { CenteredBox } from "../../layout/boxes.tsx";
import { MenuHeader } from "../root.tsx";
import { errorContext } from "./add-model-error-context.tsx";
import type {
	FullFlowRouteData,
	Model as SetupModel,
} from "./add-model-types.ts";
import {
	apiKey,
	chatGptOAuth,
	command,
	envVar,
} from "./auth-route-builders.tsx";
import {
	AuthAsk,
	type AuthChoiceRoute,
	PostAuth,
} from "./auth-route-components.tsx";
import { detectExistingProviderAuth } from "./provider-auth.ts";
import { router, type ToRoute } from "./setup-router.tsx";

function ignoreDone(_data: SetupModel): undefined {
	return undefined;
}

const customAuthDoneCtx = createContext<(auth?: Auth) => unknown>(
	() => undefined,
);
type ExistingAuthResult = boolean | Auth;

export type ExistingKeyChecker = (
	baseUrl: string,
	config: Config | null,
	provider: ProviderConfig | undefined,
	env: Record<string, string | undefined>,
) => Promise<ExistingAuthResult>;

type ExistingAuthCheckStatus =
	| "idle"
	| "checking"
	| "manual"
	| "using-existing";

type ExistingAuthCheckState = {
	baseUrl: string;
	config: Config | null;
	providerSignature: string;
	env: Record<string, string | undefined> | null;
	status: ExistingAuthCheckStatus;
};

const UNCACHED_EXISTING_AUTH_CHECK: ExistingAuthCheckState = {
	baseUrl: "",
	config: null,
	providerSignature: "",
	env: null,
	status: "idle",
};

function existingAuthProviderSignature(
	provider: ProviderConfig | undefined,
): string {
	if (!provider) return "custom";
	const authMethods = provider.authMethods;
	const authMethodCount = authMethods?.length ?? 1;
	const parts = new Array<string>(4 + authMethodCount);
	parts[0] = provider.name;
	parts[1] = provider.baseUrl;
	parts[2] = provider.type ?? "";
	parts[3] = provider.envVar;
	if (authMethods === undefined) {
		parts[4] = "api-key";
	} else {
		for (let index = 0; index < authMethods.length; index += 1) {
			parts[4 + index] = authMethods[index];
		}
	}
	return parts.join("\u001f");
}

function useStableProviderForSignature(
	provider: ProviderConfig | undefined,
	providerSignature: string,
): ProviderConfig | undefined {
	const stableProviderRef = useRef<{
		signature: string;
		provider: ProviderConfig | undefined;
	} | null>(null);
	const stable = stableProviderRef.current;
	if (stable === null || stable.signature !== providerSignature) {
		stableProviderRef.current = { signature: providerSignature, provider };
		return provider;
	}
	return stable.provider;
}

function existingAuthStatusForCurrentInput(
	state: ExistingAuthCheckState,
	baseUrl: string,
	config: Config | null,
	providerSignature: string,
	env: Record<string, string | undefined>,
): ExistingAuthCheckStatus {
	if (
		state.baseUrl !== baseUrl ||
		state.config !== config ||
		state.providerSignature !== providerSignature ||
		state.env !== env
	) {
		return "idle";
	}
	return state.status;
}

export const hasExistingKeyForAuthFlow: ExistingKeyChecker = async (
	baseUrl,
	config,
	provider,
	env,
) => {
	if (!provider) return await hasExistingKeyForBaseUrl(baseUrl, config);
	const detectedAuth = detectExistingProviderAuth(provider, config, env);
	if (detectedAuth) return detectedAuth.overrideAuth ?? true;
	const hasKey = await hasExistingKeyForModel(
		{
			baseUrl,
			type: provider.type,
		},
		config,
	);
	if (hasKey) return true;
	return false;
};

type CustomAuthFlowData = Pick<
	FullFlowRouteData,
	"authAsk" | "envVar" | "chatGptOAuth" | "command" | "apiKey" | "postAuth"
>;
const customAuthFlow = router<CustomAuthFlowData>();
type CustomAuthFlowToRoute = ToRoute<CustomAuthFlowData>;

function CustomAuthAskRoute({
	to,
	...props
}: CustomAuthFlowData["authAsk"] & {
	to: Pick<
		CustomAuthFlowToRoute,
		"apiKey" | "chatGptOAuth" | "command" | "envVar"
	>;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleSelect = useCallback(
		(route: AuthChoiceRoute) => toRef.current[route](propsRef.current),
		[propsRef, toRef],
	);
	const handleBack = useCallback(() => propsRef.current.cancel(), [propsRef]);
	return <AuthAsk {...props} onSelect={handleSelect} back={handleBack} />;
}

function CustomAuthPostAuthRoute(props: CustomAuthFlowData["postAuth"]) {
	const done = useContext(customAuthDoneCtx);
	const handleAuth = useCallback(() => done(props.auth), [done, props.auth]);
	return <PostAuth {...props} handleAuth={handleAuth} />;
}

const customAuthRoutes = customAuthFlow.route({
	authAsk: (to) => (props) => <CustomAuthAskRoute {...props} to={to} />,
	envVar,
	chatGptOAuth,
	command,
	apiKey,
	postAuth: () => (props) => <CustomAuthPostAuthRoute {...props} />,
});

export function CustomAuthFlow({
	onComplete,
	onCancel,
	baseUrl,
	provider,
	config,
	hasExistingKey = hasExistingKeyForAuthFlow,
	env = process.env,
}: {
	onComplete: (auth?: Auth) => unknown;
	onCancel: () => unknown;
	baseUrl: string;
	provider?: ProviderConfig;
	config: Config | null;
	hasExistingKey?: ExistingKeyChecker;
	env?: Record<string, string | undefined>;
}) {
	const [errorMessage, setErrorMessage] = useState("");
	const [existingAuthCheck, setExistingAuthCheck] = useState(
		UNCACHED_EXISTING_AUTH_CHECK,
	);
	const cancelledRef = useRef(false);
	const onCompleteRef = useLatestRef(onComplete);
	const onCancelRef = useLatestRef(onCancel);
	const hasExistingKeyRef = useLatestRef(hasExistingKey);
	const completeAuth = useCallback((auth?: Auth) => {
		return onCompleteRef.current(auth);
	}, []);
	const cancelAuth = useCallback(() => {
		cancelledRef.current = true;
		return onCancelRef.current();
	}, []);
	const errorContextValue = useMemo(
		() => ({ errorMessage, setErrorMessage }),
		[errorMessage],
	);
	const providerSignature = useMemo(
		() => existingAuthProviderSignature(provider),
		[
			provider?.name,
			provider?.baseUrl,
			provider?.type,
			provider?.envVar,
			provider?.authMethods,
		],
	);
	const stableProvider = useStableProviderForSignature(
		provider,
		providerSignature,
	);
	const routeProps = useMemo(
		() => ({
			renderExamples: false,
			done: ignoreDone,
			cancel: cancelAuth,
			baseUrl,
			provider: stableProvider,
			config,
			env,
		}),
		[baseUrl, cancelAuth, config, env, stableProvider],
	);
	const authTargetKey = `${baseUrl}\u001f${providerSignature}`;

	const existingAuthStatus = existingAuthStatusForCurrentInput(
		existingAuthCheck,
		baseUrl,
		config,
		providerSignature,
		env,
	);
	const hasCheckedExistingAuth = existingAuthStatus === "manual";
	const checkingInputOptions = useMemo(
		() => ({ isActive: !hasCheckedExistingAuth }),
		[hasCheckedExistingAuth],
	);

	useLatestInput(
		useCallback(
			(_, key) => {
				if (key.escape) cancelAuth();
			},
			[cancelAuth],
		),
		checkingInputOptions,
	);

	useEffect(() => {
		if (existingAuthStatus !== "idle") return;
		let alive = true;
		const markStatus = (status: ExistingAuthCheckStatus) => {
			setExistingAuthCheck({
				baseUrl,
				config,
				providerSignature,
				env,
				status,
			});
		};
		cancelledRef.current = false;
		setErrorMessage("");
		markStatus("checking");
		Promise.resolve()
			.then(() =>
				hasExistingKeyRef.current(baseUrl, config, stableProvider, env),
			)
			.then(
				(existingAuth) => {
					if (!alive || cancelledRef.current) return;
					if (existingAuth) {
						markStatus("using-existing");
						Promise.resolve()
							.then(() =>
								onCompleteRef.current(
									existingAuth === true ? undefined : existingAuth,
								),
							)
							.catch((error: unknown) => {
								if (!alive || cancelledRef.current) return;
								setErrorMessage(
									`Failed to use existing authentication: ${errorToString(error)}`,
								);
								markStatus("manual");
							});
						return;
					}
					markStatus("manual");
				},
				(error) => {
					if (!alive || cancelledRef.current) return;
					setErrorMessage(
						`Failed to check existing authentication: ${errorToString(error)}`,
					);
					markStatus("manual");
				},
			);
		return () => {
			alive = false;
		};
	}, [baseUrl, config, env, stableProvider, providerSignature]);

	if (!hasCheckedExistingAuth) {
		return (
			<CenteredBox>
				<MenuHeader title="Checking existing authentication..." />
			</CenteredBox>
		);
	}

	return (
		<errorContext.Provider value={errorContextValue}>
			<customAuthDoneCtx.Provider value={completeAuth}>
				<customAuthRoutes.Root
					key={authTargetKey}
					route="authAsk"
					props={routeProps}
				/>
			</customAuthDoneCtx.Provider>
		</errorContext.Provider>
	);
}
