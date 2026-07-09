import { useCallback, useMemo, useState } from "react";
import { useLatestRef } from "../../input/latest_input.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import { errorContext } from "./add-model-error-context.tsx";
import { baseUrl } from "./add-model-route-builders.tsx";
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

type CustomAutofixFlowRouteData = Pick<
	FullFlowRouteData,
	| "baseUrl"
	| "authAsk"
	| "envVar"
	| "chatGptOAuth"
	| "command"
	| "apiKey"
	| "postAuth"
	| "model"
	| "testConnection"
	| "context"
>;
const customAutofixFlow = router<CustomAutofixFlowRouteData>();
type CustomAutofixFlowToRoute = ToRoute<CustomAutofixFlowRouteData>;

function AutofixAuthAskRoute({
	to,
	...props
}: CustomAutofixFlowRouteData["authAsk"] & {
	to: Pick<
		CustomAutofixFlowToRoute,
		"apiKey" | "baseUrl" | "chatGptOAuth" | "command" | "envVar"
	>;
}) {
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

function AutofixPostAuthRoute({
	to,
	...props
}: CustomAutofixFlowRouteData["postAuth"] & {
	to: Pick<CustomAutofixFlowToRoute, "model">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleAuth = useCallback(
		() => toRef.current.model(propsRef.current),
		[propsRef, toRef],
	);
	return <PostAuth {...props} handleAuth={handleAuth} />;
}

function AutofixModelRoute({
	to,
	...props
}: CustomAutofixFlowRouteData["model"] & {
	to: Pick<CustomAutofixFlowToRoute, "testConnection">;
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

function AutofixTestConnectionRoute({
	to,
	...props
}: CustomAutofixFlowRouteData["testConnection"] & {
	to: Pick<CustomAutofixFlowToRoute, "context" | "model">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(
		() => toRef.current.model(propsRef.current),
		[propsRef, toRef],
	);
	const handleSubmit = useCallback(
		(metadata: ModelMetadata) =>
			toRef.current.context({
				...propsRef.current,
				nickname: "custom-autofix",
				metadata,
			}),
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

function AutofixContextRoute({
	to,
	...props
}: CustomAutofixFlowRouteData["context"] & {
	to: Pick<CustomAutofixFlowToRoute, "model">;
}) {
	const propsRef = useLatestRef(props);
	const toRef = useLatestRef(to);
	const handleBack = useCallback(
		() => toRef.current.model(propsRef.current),
		[propsRef, toRef],
	);
	return <Context {...props} back={handleBack} />;
}

const customAutofixRoutes = customAutofixFlow.route({
	baseUrl,
	envVar,
	chatGptOAuth,
	command,
	apiKey,

	authAsk: (to) => (props) => <AutofixAuthAskRoute {...props} to={to} />,

	postAuth: (to) => (props) => <AutofixPostAuthRoute {...props} to={to} />,

	model: (to) => (props) => <AutofixModelRoute {...props} to={to} />,

	testConnection: (to) => (props) => (
		<AutofixTestConnectionRoute {...props} to={to} />
	),

	context: (to) => (props) => <AutofixContextRoute {...props} to={to} />,
});

export function CustomAutofixFlow({
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
			renderExamples: false,
			done,
			cancel,
			config,
		}),
		[cancel, config, done],
	);
	return (
		<errorContext.Provider value={errorContextValue}>
			<customAutofixRoutes.Root route="baseUrl" props={routeProps} />
		</errorContext.Provider>
	);
}
