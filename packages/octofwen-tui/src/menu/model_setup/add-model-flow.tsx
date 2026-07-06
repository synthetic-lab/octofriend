import { createContext, useContext, useEffect, useState } from "react";
import { hasExistingKeyForBaseUrl } from "../../internal/configuration/keys.ts";
import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import { errorContext } from "./add-model-error-context.tsx";
import {
	apiKey,
	baseUrl,
	command,
	envVar,
	fullFlow,
	nickname,
} from "./add-model-route-builders.tsx";
import {
	AuthAsk,
	Context,
	Model,
	PostAuth,
	TestConnection,
} from "./add-model-route-components.tsx";
import type {
	FullFlowRouteData,
	Model as SetupModel,
} from "./add-model-types.ts";
import { router } from "./primitives.tsx";

const fullFlowRoutes = fullFlow.route({
	baseUrl,
	envVar,
	command,
	apiKey,
	nickname,

	authAsk: (to) => (props) => {
		return (
			<AuthAsk
				{...props}
				onSelect={(route) => to[route](props)}
				back={() => to.baseUrl(props)}
			/>
		);
	},

	postAuth: (to) => (props) => {
		return <PostAuth {...props} handleAuth={() => to.model(props)} />;
	},

	model: (to) => (props) => {
		return (
			<Model
				{...props}
				back={() => to.authAsk(props)}
				onSubmit={(model) => to.testConnection({ ...props, model })}
			/>
		);
	},

	testConnection: (to) => (props) => {
		return (
			<TestConnection
				{...props}
				back={() => to.model(props)}
				errorNav={() => to.baseUrl(props)}
				onSubmit={(metadata) => to.nickname({ ...props, metadata })}
			/>
		);
	},

	context: (to) => (props) => {
		return <Context {...props} back={() => to.nickname(props)} />;
	},
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
	return (
		<errorContext.Provider value={{ errorMessage, setErrorMessage }}>
			<fullFlowRoutes.Root
				route="baseUrl"
				props={{
					renderExamples: true,
					done: onComplete,
					cancel: onCancel,
					config: config,
				}}
			/>
		</errorContext.Provider>
	);
}

type CustomModelFlowRouteData = Pick<
	FullFlowRouteData,
	"model" | "testConnection" | "nickname" | "context"
>;
const customModelFlow = router<CustomModelFlowRouteData>();
const customModelFlowRoutes = customModelFlow.route({
	model: (to) => (props) => {
		return (
			<Model
				{...props}
				back={() => props.cancel()}
				onSubmit={(model) => to.testConnection({ ...props, model })}
			/>
		);
	},

	testConnection: (to) => (props) => {
		return (
			<TestConnection
				{...props}
				back={() => to.model(props)}
				errorNav={() => to.model(props)}
				onSubmit={(metadata) => to.nickname({ ...props, metadata })}
			/>
		);
	},

	nickname,

	context: (to) => (props) => {
		return <Context {...props} back={() => to.nickname(props)} />;
	},
});

export function CustomModelFlow({
	onComplete,
	onCancel,
	baseUrl,
	auth,
	config,
}: {
	onComplete: (args: SetupModel) => unknown;
	onCancel: () => unknown;
	baseUrl: string;
	auth?: Auth;
	config: Config | null;
}) {
	const [errorMessage, setErrorMessage] = useState("");
	return (
		<errorContext.Provider value={{ errorMessage, setErrorMessage }}>
			<customModelFlowRoutes.Root
				route="model"
				props={{
					renderExamples: false,
					done: onComplete,
					cancel: onCancel,
					baseUrl,
					auth,
					config,
				}}
			/>
		</errorContext.Provider>
	);
}

const customAuthDoneCtx = createContext<(auth?: Auth) => unknown>(
	() => undefined,
);
type CustomAuthFlowData = Pick<
	FullFlowRouteData,
	"authAsk" | "envVar" | "command" | "apiKey" | "postAuth"
>;
const customAuthFlow = router<CustomAuthFlowData>();
const customAuthRoutes = customAuthFlow.route({
	authAsk: (to) => (props) => {
		return (
			<AuthAsk
				{...props}
				onSelect={(route) => to[route](props)}
				back={() => props.cancel()}
			/>
		);
	},
	envVar,
	command,
	apiKey,
	postAuth: (_) => (props) => {
		const done = useContext(customAuthDoneCtx);
		return <PostAuth {...props} handleAuth={() => done(props.auth)} />;
	},
});

export function CustomAuthFlow({
	onComplete,
	onCancel,
	baseUrl,
	config,
}: {
	onComplete: (auth?: Auth) => unknown;
	onCancel: () => unknown;
	baseUrl: string;
	config: Config | null;
}) {
	const [errorMessage, setErrorMessage] = useState("");
	const [hasCheckedExistingKey, setHasCheckedExistingKey] = useState(false);

	useEffect(() => {
		if (!hasCheckedExistingKey) {
			hasExistingKeyForBaseUrl(baseUrl, config).then((hasKey) => {
				if (hasKey) {
					onComplete();
				}
				setHasCheckedExistingKey(true);
			});
		}
	}, [hasCheckedExistingKey, baseUrl, config, onComplete]);

	// Show nothing while checking for existing key (will auto-complete if found)
	if (!hasCheckedExistingKey) {
		return null;
	}

	return (
		<errorContext.Provider value={{ errorMessage, setErrorMessage }}>
			<customAuthDoneCtx.Provider value={onComplete}>
				<customAuthRoutes.Root
					route="authAsk"
					props={{
						renderExamples: false,
						done: () => undefined,
						cancel: onCancel,
						baseUrl,
						config,
					}}
				/>
			</customAuthDoneCtx.Provider>
		</errorContext.Provider>
	);
}

type CustomAutofixFlowRouteData = Pick<
	FullFlowRouteData,
	| "baseUrl"
	| "authAsk"
	| "envVar"
	| "command"
	| "apiKey"
	| "postAuth"
	| "model"
	| "testConnection"
	| "context"
>;
const customAutofixFlow = router<CustomAutofixFlowRouteData>();
const customAutofixRoutes = customAutofixFlow.route({
	baseUrl,
	envVar,
	command,
	apiKey,

	authAsk: (to) => (props) => {
		return (
			<AuthAsk
				{...props}
				onSelect={(route) => to[route](props)}
				back={() => to.baseUrl(props)}
			/>
		);
	},

	postAuth: (to) => (props) => {
		return <PostAuth {...props} handleAuth={() => to.model(props)} />;
	},

	model: (to) => (props) => {
		return (
			<Model
				{...props}
				back={() => props.cancel()}
				onSubmit={(model) => to.testConnection({ ...props, model })}
			/>
		);
	},

	testConnection: (to) => (props) => {
		return (
			<TestConnection
				{...props}
				back={() => to.model(props)}
				errorNav={() => to.model(props)}
				onSubmit={(metadata) =>
					to.context({ ...props, nickname: "custom-autofix", metadata })
				}
			/>
		);
	},

	context: (to) => (props) => {
		return <Context {...props} back={() => to.model(props)} />;
	},
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
	return (
		<errorContext.Provider value={{ errorMessage, setErrorMessage }}>
			<customAutofixRoutes.Root
				route="baseUrl"
				props={{
					renderExamples: false,
					done: onComplete,
					cancel: onCancel,
					config,
				}}
			/>
		</errorContext.Provider>
	);
}
