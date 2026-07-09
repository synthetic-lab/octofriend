import { fullFlow } from "./routes";
import {
	envVarExampleForBaseUrl as envVarExampleForBaseUrlImpl,
	envVarHasNonEmptyValue as envVarHasNonEmptyValueImpl,
	normalizeEnvVarName as normalizeEnvVarNameImpl,
	secretPathExampleForBaseUrl as secretPathExampleForBaseUrlImpl,
} from "./auth-input";
import {
	ApiKeyRoute,
	ChatGptOAuthRoute,
	CommandRoute,
	EnvVarRoute,
} from "./input-routes";

export const envVarExampleForBaseUrl = envVarExampleForBaseUrlImpl;
export const normalizeEnvVarName = normalizeEnvVarNameImpl;
export const envVarHasNonEmptyValue = envVarHasNonEmptyValueImpl;
export const secretPathExampleForBaseUrl = secretPathExampleForBaseUrlImpl;

export const envVar = fullFlow
	.withRoutes("authAsk", "envVar", "postAuth")
	.build("envVar", (to) => (props) => <EnvVarRoute {...props} to={to} />);

export const chatGptOAuth = fullFlow
	.withRoutes("authAsk", "chatGptOAuth", "postAuth")
	.build("chatGptOAuth", (to) => (props) => (
		<ChatGptOAuthRoute {...props} to={to} />
	));

export const command = fullFlow
	.withRoutes("authAsk", "command", "postAuth")
	.build("command", (to) => (props) => <CommandRoute {...props} to={to} />);

export const apiKey = fullFlow
	.withRoutes("apiKey", "authAsk", "postAuth")
	.build("apiKey", (to) => (props) => <ApiKeyRoute {...props} to={to} />);
