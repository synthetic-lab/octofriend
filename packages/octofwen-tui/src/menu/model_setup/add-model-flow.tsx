import { useCallback, useMemo, useState } from "react";
import { useLatestRef } from "../../input/latest_input.ts";
import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import type { ProviderConfig } from "../../internal/model-provider-catalog/main.ts";
import { CustomAutofixFlow as CustomAutofixFlowImpl } from "./add-model-autofix-flow.tsx";
import { errorContext } from "./add-model-error-context.tsx";
import { baseUrl, fullFlow, nickname } from "./add-model-route-builders.tsx";
import {
	Context,
	Model,
	TestConnection,
} from "./add-model-route-components.tsx";
import type {
	FullFlowRouteData,
	ModelMetadata,
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
import { router, type ToRoute } from "./setup-router.tsx";

type FullFlowToRoute = ToRoute<FullFlowRouteData>;

function AuthAskRoute({
	to,
	...props
}: FullFlowRouteData["authAsk"] & { to: FullFlowToRoute }) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleSelect = useCallback(
		(route: AuthChoiceRoute) => toRef.current[route](propsRef.current),
		[propsRef, toRef],
	);
	const handleBack = useCallback(
		() => toRef.current.baseUrl(propsRef.current),
		[propsRef, toRef],
	);
	return <AuthAsk {...props} onSelect={handleSelect} back={handleBack} />;
}

function PostAuthRoute({
	to,
	...props
}: FullFlowRouteData["postAuth"] & { to: Pick<FullFlowToRoute, "model"> }) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleAuth = useCallback(
		() => toRef.current.model(propsRef.current),
		[propsRef, toRef],
	);
	return <PostAuth {...props} handleAuth={handleAuth} />;
}

function FullModelRoute({
	to,
	...props
}: FullFlowRouteData["model"] & {
	to: Pick<FullFlowToRoute, "authAsk" | "testConnection">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(
		() => toRef.current.authAsk(propsRef.current),
		[propsRef, toRef],
	);
	const handleSubmit = useCallback(
		(model: string) =>
			toRef.current.testConnection({ ...propsRef.current, model }),
		[propsRef, toRef],
	);
	return <Model {...props} back={handleBack} onSubmit={handleSubmit} />;
}

function FullTestConnectionRoute({
	to,
	...props
}: FullFlowRouteData["testConnection"] & {
	to: Pick<FullFlowToRoute, "baseUrl" | "model" | "nickname">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(
		() => toRef.current.model(propsRef.current),
		[propsRef, toRef],
	);
	const handleErrorNav = useCallback(
		() => toRef.current.baseUrl(propsRef.current),
		[propsRef, toRef],
	);
	const handleSubmit = useCallback(
		(metadata: ModelMetadata) =>
			toRef.current.nickname({ ...propsRef.current, metadata }),
		[propsRef, toRef],
	);
	return (
		<TestConnection
			{...props}
			back={handleBack}
			errorNav={handleErrorNav}
			onSubmit={handleSubmit}
		/>
	);
}

function NicknameBackContextRoute({
	to,
	...props
}: FullFlowRouteData["context"] & {
	to: Pick<FullFlowToRoute, "nickname">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(
		() => toRef.current.nickname(propsRef.current),
		[propsRef, toRef],
	);
	return <Context {...props} back={handleBack} />;
}

const fullFlowRoutes = fullFlow.route({
	baseUrl,
	chatGptOAuth,
	envVar,
	command,
	apiKey,
	nickname,

	authAsk: (to) => (props) => <AuthAskRoute {...props} to={to} />,

	postAuth: (to) => (props) => <PostAuthRoute {...props} to={to} />,

	model: (to) => (props) => <FullModelRoute {...props} to={to} />,

	testConnection: (to) => (props) => (
		<FullTestConnectionRoute {...props} to={to} />
	),

	context: (to) => (props) => <NicknameBackContextRoute {...props} to={to} />,
});

export function FullAddModelFlow({
	onComplete,
	onCancel,
	config,
}: {
	onComplete: (args: SetupModel) => unknown;
	onCancel: () => unknown;
	config: Config | null;
}) {
	const [errorMessage, setErrorMessage] = useState("");
	const onCancelRef = useLatestRef(onCancel);
	const onCompleteRef = useLatestRef(onComplete);
	const cancel = useCallback(() => onCancelRef.current(), [onCancelRef]);
	const done = useCallback(
		(args: SetupModel) => onCompleteRef.current(args),
		[onCompleteRef],
	);
	const errorContextValue = useMemo(
		() => ({ errorMessage, setErrorMessage }),
		[errorMessage],
	);
	const routeProps = useMemo(
		() => ({
			renderExamples: true,
			done,
			cancel,
			config,
		}),
		[cancel, config, done],
	);
	return (
		<errorContext.Provider value={errorContextValue}>
			<fullFlowRoutes.Root route="baseUrl" props={routeProps} />
		</errorContext.Provider>
	);
}

type CustomModelFlowRouteData = Pick<
	FullFlowRouteData,
	"model" | "testConnection" | "nickname" | "context"
>;
const customModelFlow = router<CustomModelFlowRouteData>();
type CustomModelFlowToRoute = ToRoute<CustomModelFlowRouteData>;

function CustomModelRoute({
	to,
	...props
}: CustomModelFlowRouteData["model"] & {
	to: Pick<CustomModelFlowToRoute, "testConnection">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(() => propsRef.current.cancel(), [propsRef]);
	const handleSubmit = useCallback(
		(model: string) =>
			toRef.current.testConnection({ ...propsRef.current, model }),
		[propsRef, toRef],
	);
	return <Model {...props} back={handleBack} onSubmit={handleSubmit} />;
}

function CustomModelTestConnectionRoute({
	to,
	...props
}: CustomModelFlowRouteData["testConnection"] & {
	to: Pick<CustomModelFlowToRoute, "model" | "nickname">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(
		() => toRef.current.model(propsRef.current),
		[propsRef, toRef],
	);
	const handleSubmit = useCallback(
		(metadata: ModelMetadata) =>
			toRef.current.nickname({ ...propsRef.current, metadata }),
		[propsRef, toRef],
	);
	return (
		<TestConnection
			{...props}
			back={handleBack}
			errorNav={handleBack}
			onSubmit={handleSubmit}
		/>
	);
}

function CustomModelContextRoute({
	to,
	...props
}: CustomModelFlowRouteData["context"] & {
	to: Pick<CustomModelFlowToRoute, "nickname">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(
		() => toRef.current.nickname(propsRef.current),
		[propsRef, toRef],
	);
	return <Context {...props} back={handleBack} />;
}

const customModelFlowRoutes = customModelFlow.route({
	model: (to) => (props) => <CustomModelRoute {...props} to={to} />,

	testConnection: (to) => (props) => (
		<CustomModelTestConnectionRoute {...props} to={to} />
	),

	nickname,

	context: (to) => (props) => <CustomModelContextRoute {...props} to={to} />,
});

export function CustomModelFlow({
	onComplete,
	onCancel,
	baseUrl,
	provider,
	auth,
	config,
}: {
	onComplete: (args: SetupModel) => unknown;
	onCancel: () => unknown;
	baseUrl: string;
	provider?: ProviderConfig;
	auth?: Auth;
	config: Config | null;
}) {
	const [errorMessage, setErrorMessage] = useState("");
	const onCancelRef = useLatestRef(onCancel);
	const onCompleteRef = useLatestRef(onComplete);
	const cancel = useCallback(() => onCancelRef.current(), [onCancelRef]);
	const done = useCallback(
		(args: SetupModel) => onCompleteRef.current(args),
		[onCompleteRef],
	);
	const errorContextValue = useMemo(
		() => ({ errorMessage, setErrorMessage }),
		[errorMessage],
	);
	const routeProps = useMemo(
		() => ({
			renderExamples: false,
			done,
			cancel,
			baseUrl,
			provider,
			auth,
			config,
		}),
		[auth, baseUrl, cancel, config, done, provider],
	);
	return (
		<errorContext.Provider value={errorContextValue}>
			<customModelFlowRoutes.Root route="model" props={routeProps} />
		</errorContext.Provider>
	);
}

export const CustomAutofixFlow = CustomAutofixFlowImpl;
